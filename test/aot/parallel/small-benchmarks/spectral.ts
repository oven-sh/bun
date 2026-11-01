// The spectral-norm benchmark, with `Float64Array`.
function A(i: number, j: number): number { return 1 / (((i + j) * (i + j + 1)) / 2 + i + 1) }
function Au(u: Float64Array, v: Float64Array): void {
  const n = u.length
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < n; j++) t += A(i, j) * u[j]!; v[i] = t }
}
function Atu(u: Float64Array, v: Float64Array): void {
  const n = u.length
  for (let i = 0; i < n; i++) { let t = 0; for (let j = 0; j < n; j++) t += A(j, i) * u[j]!; v[i] = t }
}
function AtAu(u: Float64Array, v: Float64Array, w: Float64Array): void { Au(u, w); Atu(w, v) }
const t0 = performance.now()
const n = 2000, u = new Float64Array(n).fill(1), v = new Float64Array(n), w = new Float64Array(n)
for (let i = 0; i < 10; i++) { AtAu(u, v, w); AtAu(v, u, w) }
let vBv = 0, vv = 0
for (let i = 0; i < n; i++) { vBv += u[i]! * v[i]!; vv += v[i]! * v[i]! }
console.log("spectral", Math.sqrt(vBv / vv).toFixed(9), (performance.now() - t0).toFixed(0) + "ms")
