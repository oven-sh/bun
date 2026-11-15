// Sums of columns, stored into a vector whose type admits null.
function colsum(a, v, m, n) { for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += a[i][j]; v[j] = s; } return v; }
function vecmat(v, a, r, m, n) { for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += v[i] * a[i][j]; r[j] = s; } return r; }
const any = (m, k, f) => Array.from({ length: m }, (_, i) => Array.from({ length: k }, (_, j) => f(i, j)));
const real = (i, j) => Math.sin(i * 7 + j * 3 + 1);
const K = Number(process.argv[2] || 3), N = Number(process.argv[3] || 20);
const a = any(N, N, real), v = any(1, N, real)[0], w = any(1, N, real)[0];
const work = { colsum: () => colsum(a, v, N, N), vecmat: () => vecmat(v, a, w, N, N) };
for (let k = 0; k < K; k++) for (const name of Object.keys(work)) work[process.argv[4] || name]();
console.log(v.join(), w.join());
