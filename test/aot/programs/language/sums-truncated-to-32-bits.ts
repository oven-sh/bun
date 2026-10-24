// Sums in a hash loop that are truncated to 32 bits.
declare const console: { log(...values: unknown[]): void }

function hashPast(text: string, from: number, to: number): number {
    let h = 7
    for (let i = from; i < to; i++)
        h = (h * 31 + text.charCodeAt(i)) | 0
    return h
}

function onePast(text: string, index: number, seed: number): number {
    const x = seed | 0
    return (x + text.charCodeAt(index)) | 0
}

function oneLess(text: string, index: number, seed: number): number {
    const x = seed | 0
    return (text.charCodeAt(index) - x) | 0
}

function aboveExact(times: number): number {
    let n = 9007199254740985
    let r = 0
    for (let i = 0; i < times; i++) {
        n += 1
        r = (r * 3) ^ ((n + i) | 0)
    }
    return r
}

function belowExact(times: number): number {
    let n = -9007199254740985
    let r = 0
    for (let i = 0; i < times; i++) {
        n -= 1
        r = (r * 3) ^ ((n - i) | 0)
    }
    return r
}

function products(a: number, b: number, c: number): number {
    const x = (a | 0) * 4194304
    const y = (b | 0) * 4194304
    return ((x + y) | 0) ^ ((x - y) | 0) ^ (c | 0)
}

function wide(a: number, c: number): number {
    return (a | 0) * 2097152 + (c | 0)
}

function sumOfWide(a: number, c: number, b: number, d: number): number {
    const x = (a | 0) * 2097152 + (c | 0)
    const y = (b | 0) * 2097152 + (d | 0)
    return (x + y) | 0
}

function differenceOfWide(a: number, c: number, b: number, d: number): number {
    const x = (a | 0) * 2097152 + (c | 0)
    const y = (b | 0) * 2097152 + (d | 0)
    return (x - y) | 0
}

function sumOfProducts(a: number, b: number): number {
    const x = (a | 0) * 2097152
    const y = (b | 0) * 2097153
    return (x + y) | 0
}

function differenceOfProducts(a: number, b: number): number {
    const x = (a | 0) * 2097152
    const y = (b | 0) * 2097153
    return (x - y) | 0
}

function sumOfCounts(times: number): number {
    let n = 4503599627370496
    let m = 4503599627370496
    let r = 0
    for (let i = 0; i < times; i++) {
        n += 1
        if (i & 1)
            m += 1
        r = (r * 3) ^ ((n + m) | 0)
    }
    return r
}

function sumOfCountsDown(times: number): number {
    let n = -4503599627370496
    let m = -4503599627370496
    let r = 0
    for (let i = 0; i < times; i++) {
        n -= 1
        if (i & 1)
            m -= 1
        r = (r * 3) ^ ((n + m) | 0)
    }
    return r
}

function differenceOfCounts(times: number): number {
    let n = 4503599627370496
    let m = -4503599627370496
    let r = 0
    for (let i = 0; i < times; i++) {
        n += 1
        if (i & 1)
            m -= 1
        r = (r * 3) ^ ((n - m) | 0) ^ ((m - n) | 0)
    }
    return r
}

console.log("within", hashPast("abcdef", 0, 6), onePast("abc", 1, 5), oneLess("abc", 1, 5))
console.log("past the end", hashPast("abcdef", 0, 7), hashPast("abcdef", 4, 9), onePast("abc", 3, 5), onePast("abc", -1, 5), onePast("", 0, -9), oneLess("abc", 3, 5), oneLess("abc", 99, -5))
for (const times of [1, 3, 5, 6, 7, 8, 9, 12, 20])
    console.log("above", times, aboveExact(times), "below", times, belowExact(times))
console.log("products", products(2147483647, 2147483647, 1), products(-2147483648, 2147483647, 2), products(-2147483648, -2147483648, 3), products(2147483647, -2147483648, 4), products(1073741825, 1073741827, 5))
console.log("wide", wide(2147483647, 2147483647), wide(-2147483648, -2147483648))
console.log("sums of wide", sumOfWide(1, 2, 3, 4), sumOfWide(2147483647, 2147483647, 2147483647, 2147483646), sumOfWide(2147483647, 2147483645, 2147483647, 2147483646), sumOfWide(-2147483648, -2147483648, -2147483648, -2147483647), sumOfWide(-2147483648, -2147483645, -2147483648, -2147483648))
console.log("differences of wide", differenceOfWide(9, 8, 7, 6), differenceOfWide(2147483647, 2147483647, -2147483648, -2147483646), differenceOfWide(2147483647, 2147483644, -2147483648, -2147483647), differenceOfWide(-2147483648, -2147483648, 2147483647, 2147483647), differenceOfWide(-2147483648, -2147483646, 2147483647, 2147483647))
console.log("sums of products", sumOfProducts(3, 5), sumOfProducts(2147483647, 2147483647), sumOfProducts(2147483646, 2147483645), sumOfProducts(-2147483648, -2147483647), sumOfProducts(-2147483647, -2147483645), sumOfProducts(2147483647, -2147483647))
console.log("differences of products", differenceOfProducts(3, 5), differenceOfProducts(2147483647, -2147483647), differenceOfProducts(2147483645, -2147483645), differenceOfProducts(-2147483648, 2147483647), differenceOfProducts(-2147483646, 2147483645), differenceOfProducts(2147483647, 2147483647))
for (const times of [1, 2, 3, 4, 5, 8, 13])
    console.log("counts", times, sumOfCounts(times), sumOfCountsDown(times), differenceOfCounts(times))
export {}
