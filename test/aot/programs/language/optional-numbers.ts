// Optional numbers: parameters, fields and results that may be undefined.
class P { a: number | undefined; b: number | null; c?: number; d: number | undefined | null
  constructor(a: number | undefined, b: number | null, d: number | undefined | null) { this.a = a; this.b = b; this.d = d } }
function pick(i: number): number | undefined { return i % 3 === 0 ? undefined : i }
function half(i: number): number | null { return i % 2 === 0 ? i / 4 : null }
function both(i: number): number | undefined | null { return i % 3 === 0 ? undefined : i % 3 === 1 ? null : i * 0.5 }
function show(x: number | undefined | null): string { return x === undefined ? "u" : x === null ? "n" : "" + x }
let out = ""
let sum = 0
for (let i = 0; i < 12; i++) {
  const p = new P(pick(i), half(i), both(i))
  if (i % 4 === 0) p.c = i
  sum += (p.a ?? 100) + (p.b ?? 1000) + (p.c ?? 10000) + (p.d ?? 0.25)
  out += show(p.a) + show(p.b) + show(p.c) + show(p.d) + (p.a ? "T" : "F") + (p.b ? "T" : "F") + (p.d ? "T" : "F") + (p.a === p.d ? "=" : "!") + (p.b === p.d ? "=" : "!") + (p.a == null ? "0" : "1") + " "
}
console.log(out)
console.log(sum)
const raw = new Float64Array(2), bytes = new Uint8Array(8)
raw[0] = 0 / 0
let m: number | undefined = raw[0]!
if (sum > 1e9) m = undefined
console.log(m === undefined, m !== m, show(m))
const q = new P(0, 0, 0)
console.log(q.a ? 1 : 2, q.b ? 1 : 2, q.d ? 1 : 2, q.a === 0, q.b === 0, q.d === 0, q.c === undefined, bytes.length)
console.log(JSON.stringify(new P(1, null, 2.5)), JSON.stringify(new P(undefined, 3, null)))
