// `++` and `--` on a BigInt add and subtract `1n`.
let b = 5n
b++
const o = { n: 1n }
o.n--
function next(v: bigint): bigint { let w = v; ++w; return w }
function either(v: number | bigint): number | bigint { return ++v }
console.log(String(b), String(o.n), String(next(9n)), String(either(1)), String(either(1n)), typeof either(1n))
