// `x % y` where both are whole numbers but not both non-negative 32-bit integers: times, unsigned hashes, negative dividends. Every edge of a 64-bit integer remainder is here: -0, 2^53, 2^62, 2^63, divisors of 0 and -1.
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x)
const edges: number[] = [
  "0", "-0", "1", "-1", "2", "-2", "3", "-3", "7", "-7", "1000", "-1000", "4096", "-4096",
  "2147483647", "2147483648", "2147483649", "-2147483647", "-2147483648", "-2147483649", "4294967295", "4294967296", "4294967297", "-4294967296",
  "1760000000123", "-1760000000123", "9007199254740991", "9007199254740992", "9007199254740994", "-9007199254740991", "-9007199254740992",
  "4611686018427386880", "4611686018427387904", "4611686018427388928", "-4611686018427386880", "-4611686018427387904", "-4611686018427388928",
  "9223372036854774784", "9223372036854775808", "-9223372036854775808", "-9223372036854777856", "18446744073709551616", "1e21", "-1e21", "1e308", "-1e308",
  "0.5", "-0.5", "1.5", "-1.5", "2147483648.5", "4503599627370495.5", "5e-324", "-5e-324", "NaN", "Infinity", "-Infinity",
].map(Number)
const rem = (x: number, y: number) => x % y
for (const y of edges) console.log(show(y) + ":", edges.map(x => show(rem(x, y))).join(" "))

const wrap = (i: number, n: number) => ((i % n) + n) % n
const bucket = (hash: number, buckets: number) => (hash >>> 0) % buckets
const millisecond = (time: number) => time % 1000
const inPage = (x: number) => x % 4096
const some: number[] = ["-13", "-1", "0", "5", "12", "-2147483648", "2147483647", "-4294967297"].map(Number)
console.log("wrap:", some.map(i => show(wrap(i, 12))).join(" "))
console.log("bucket:", some.map(hash => show(bucket(hash, 1021))).join(" "))
console.log("millisecond:", edges.map(time => show(millisecond(time))).join(" "))
console.log("page:", edges.map(x => show(inPage(x))).join(" "))
let sum = 0
for (let i = 0; i < 2000; i++) sum += rem(1760000000000 + i * 977, 1000) + rem(-i, 7) + rem(i * 2654435761, 1021)
console.log(sum)
