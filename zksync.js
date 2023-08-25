import './common.js'
import {
    wait,
    sleep,
    random,
    readWallets,
    writeLineToFile,
    getBalance,
    timestampToDate,
    getEthPriceForDate
} from './common.js'
import axios from "axios"
import { Table } from 'console-table-printer'
import { createObjectCsvWriter } from 'csv-writer'
import moment from 'moment'
import cliProgress from 'cli-progress'

const csvWriter = createObjectCsvWriter({
    path: './results/zksync.csv',
    header: [
        { id: 'wallet', title: 'wallet'},
        { id: 'ETH', title: 'ETH'},
        { id: 'USDC', title: 'USDC'},
        { id: 'USDT', title: 'USDT'},
        { id: 'DAI', title: 'DAI'},
        { id: 'TX Count', title: 'TX Count'},
        { id: 'Volume', title: 'Volume'},
        { id: 'Unique contracts', title: 'Unique contracts'},
        { id: 'Unique days', title: 'Unique days'},
        { id: 'Unique weeks', title: 'Unique weeks'},
        { id: 'Unique months', title: 'Unique months'},
        { id: 'First tx', title: 'First tx'},
        { id: 'Last tx', title: 'Last tx'},
        { id: 'Total gas spent', title: 'Total gas spent'}
    ]
})

const p = new Table({
  columns: [
    { name: 'wallet', color: 'green', alignment: "right"},
    { name: 'ETH', alignment: 'right', color: 'cyan'},
    { name: 'USDC', alignment: 'right', color: 'cyan'},
    { name: 'USDT', alignment: 'right', color: 'cyan'},
    { name: 'DAI', alignment: 'right', color: 'cyan'},
    { name: 'TX Count', alignment: 'right', color: 'cyan'},
    { name: 'Volume', alignment: 'right', color: 'cyan'},
    { name: 'Unique contracts', alignment: 'right', color: 'cyan'},
    { name: 'Unique days', alignment: 'right', color: 'cyan'},
    { name: 'Unique weeks', alignment: 'right', color: 'cyan'},
    { name: 'Unique months', alignment: 'right', color: 'cyan'},
    { name: 'First tx', alignment: 'right', color: 'cyan'},
    { name: 'Last tx', alignment: 'right', color: 'cyan'},
    { name: 'Total gas spent', alignment: 'right', color: 'cyan'},
  ]
})

const apiUrl = "https://block-explorer-api.mainnet.zksync.io"

let stats = []
let totalGas = 0
const filterSymbol = ['ETH', 'USDT', 'USDC', 'DAI']

async function getBalances(wallet) {
    await axios.get(apiUrl+'/address/'+wallet).then(response => {
        let balances = response.data.balances

        filterSymbol.forEach(symbol => {
            stats[wallet].balances[symbol] = 0
        })

        Object.values(balances).forEach(balance => {
            if (balance.token) {
                if (filterSymbol.includes(balance.token.symbol)) {
                    stats[wallet].balances[balance.token.symbol] = getBalance(balance.balance, balance.token.decimals)
                }
            }
        })
    }).catch(function (error) {
        console.log(`${wallet}: ${error}`)
    })
}

async function getTxs(wallet) {
    const uniqueDays = new Set()
    const uniqueWeeks = new Set()
    const uniqueMonths = new Set()
    const uniqueContracts = new Set()

    let totalGasUsed = 0
    let totalValue = 0
    let txs = []
    let page = 1
    let isAllTxCollected = false

    while (!isAllTxCollected) {
        await axios.get(apiUrl + '/transactions', {
            params: {
                address: wallet,
                page: page
            }
        }).then(response => {
            let items = response.data.items
            let meta = response.data.meta
            Object.values(items).forEach(tx => {
                txs.push(tx)
            })

            if ((meta.currentPage === meta.totalPages) || meta.totalItems == 0) {
                isAllTxCollected = true
            } else {
                page++
            }
        }).catch()
    }

    stats[wallet].txcount = txs.length
    const stables = ['USDT', 'USDC', 'BUSD', 'DAI']

    for (const tx of Object.values(txs)) {
        if (tx.status === 'verified') {
            const date = new Date(tx.receivedAt)
            let value = parseInt(tx.value) / Math.pow(10, 18)
            const targetDate = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
            uniqueDays.add(date.toDateString())
            uniqueWeeks.add(date.getFullYear() + '-' + date.getWeek())
            uniqueMonths.add(date.getFullYear() + '-' + date.getMonth())
            uniqueContracts.add(tx.to)

            if (value > 0.003) {
                const ethPrice = await getEthPriceForDate(targetDate)
                totalValue += value * ethPrice
            }

            await axios.get(apiUrl + '/transactions/'+tx.hash+'/transfers', {
                params: {
                    limit: 100,
                    page: 1
                }
            }).then(response => {
                for (const transfer of response.data.items) {
                    if (transfer.type === 'transfer') {
                        if (transfer.token) {
                            if (stables.includes(transfer.token.symbol)) {
                                let amount = parseInt(transfer.amount) / Math.pow(10, transfer.token.decimals)
                                totalValue += amount
                                break
                            }
                        }
                    }
                }
            }).catch()
        }

        totalGasUsed += parseInt(tx.fee) / Math.pow(10, 18)
    }

    if (txs.length) {
        stats[wallet].first_tx_date = new Date(txs[txs.length - 1].receivedAt)
        stats[wallet].last_tx_date = new Date(txs[0].receivedAt)
        stats[wallet].unique_days = uniqueDays.size
        stats[wallet].unique_weeks = uniqueWeeks.size
        stats[wallet].unique_months = uniqueMonths.size
        stats[wallet].unique_contracts = uniqueContracts.size
        stats[wallet].total_gas = totalGasUsed
        stats[wallet].total_value = totalValue
    }
}

const wallets = readWallets('./addresses/zksync.txt')
let iterations = wallets.length
let iteration = 1
let csvData = []
let total = {
    eth: 0,
    usdc: 0,
    usdt: 0,
    dai: 0,
    gas: 0
}

let ethPrice = 0
await axios.get('https://min-api.cryptocompare.com/data/price?fsym=ETH&tsyms=USD').then(response => {
    ethPrice = response.data.USD
})

const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
progressBar.start(iterations, 0)

for (let wallet of wallets) {
    stats[wallet] = {
        balances: []
    }

    await getBalances(wallet)
    await getTxs(wallet)
    progressBar.update(iteration++)
    await sleep(1.5 * 1000)
    let usdEthValue = (stats[wallet].balances['ETH']*ethPrice).toFixed(2)
    let usdGasValue = (stats[wallet].total_gas*ethPrice).toFixed(2)

    total.gas += stats[wallet].total_gas
    total.eth += stats[wallet].balances['ETH']
    total.usdt += stats[wallet].balances['USDT']
    total.usdc += stats[wallet].balances['USDC']
    total.dai += stats[wallet].balances['DAI']

    let row
    if (stats[wallet].txcount) {
        row = {
            wallet: wallet,
            'ETH': stats[wallet].balances['ETH'] + ` ($${usdEthValue})`,
            'USDC': stats[wallet].balances['USDC'].toFixed(2),
            'USDT': stats[wallet].balances['USDT'].toFixed(2),
            'DAI': stats[wallet].balances['DAI'].toFixed(2),
            'TX Count': stats[wallet].txcount,
            'Volume': '$'+stats[wallet].total_value.toFixed(2),
            'Unique contracts': stats[wallet].unique_contracts,
            'Unique days': stats[wallet].unique_days,
            'Unique weeks': stats[wallet].unique_weeks,
            'Unique months': stats[wallet].unique_months,
            'First tx': moment(stats[wallet].first_tx_date).format("DD.MM.YY"),
            'Last tx': moment(stats[wallet].last_tx_date).format("DD.MM.YY"),
            'Total gas spent': stats[wallet].total_gas.toFixed(4)  + ` ($${usdGasValue})`
        }

        p.addRow(row)
    }

    if (!--iterations) {
        progressBar.stop()
        p.addRow({})

        row = {
            wallet: 'Total',
            'ETH': total.eth + ` ($${(total.eth*ethPrice).toFixed(2)})`,
            'USDC': total.usdc,
            'USDT': total.usdt,
            'DAI': total.dai,
            'TX Count': '',
            'Volume': '',
            'Unique contracts': '',
            'Unique days': '',
            'Unique weeks': '',
            'Unique months': '',
            'First tx': '',
            'Last tx': '',
            'Total gas spent': total.gas.toFixed(4)  + ` ($${(total.gas*ethPrice).toFixed(2)})`
        }

        p.addRow(row)

        p.printTable()

        p.table.rows.map((row) => {
            csvData.push(row.text)
        })

        csvWriter.writeRecords(csvData)
            .then(() => console.log('Запись в CSV файл завершена'))
            .catch(error => console.error('Произошла ошибка при записи в CSV файл:', error))
    }
}