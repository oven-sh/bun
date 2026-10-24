// `x % y`: the integer remainder where both operands are 32-bit integers, fmod for everything else.
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x)
const xs: number[] = ["0", "-0", "1", "7", "8", "9", "-1", "-7", "-8", "-9", "2147483647", "-2147483648", "2147483648", "4294967303", "0.5", "-0.5", "8.5", "1e21", "NaN", "Infinity", "-Infinity", "5e-324"].map(Number)
const ys: number[] = ["8", "7", "1", "-3", "-8", "0", "-0", "2.5", "NaN", "Infinity", "2147483647", "-2147483648", "4294967296"].map(Number)
const by8 = (x: number) => x % 8, by7 = (x: number) => x % 7, byMinus3 = (x: number) => x % -3, by1 = (x: number) => x % 1, by0 = (x: number) => x % 0, byHalf = (x: number) => x % 2.5, byMost = (x: number) => x % 2147483647, byLeast = (x: number) => x % -2147483648
const of100 = (y: number) => 100 % y, ofMinus100 = (y: number) => -100 % y
console.log("constants:", xs.map(x => [by8(x), by7(x), byMinus3(x), by1(x), by0(x), byHalf(x), byMost(x), byLeast(x)].map(show).join()).join(" "))
console.log("constant dividends:", ys.map(y => show(of100(y)) + "," + show(ofMinus100(y))).join(" "))
const rem = (x: number, y: number) => x % y
for (const y of ys) console.log(show(y) + ":", xs.map(x => show(rem(x, y))).join(" "))
let turns = 0; for (let i = 0; i < 100; i++) if (rem(i, 3) === 0) turns++
console.log(turns)
