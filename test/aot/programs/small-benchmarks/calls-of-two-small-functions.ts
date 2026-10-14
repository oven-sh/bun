// A small benchmark: calls of two small functions.
function inc(a: number) { return a + 1 }
function dec(a: number) { return a - 1 }
;(inc as any).p = 1; (dec as any).p = 1
const fs: any[] = [inc, dec, inc]
function run(n: number) { let x = 0; for (let i = 0; i < n; i++) { const f = fs[i % 3]; x = f(x) } return x }
console.log(run(Number((globalThis as any).N ?? 30000000)))
