function two(n) { const m = n | 0, low = [], high = []; for (let i = 0; i < m; i++) { low[i] = i & 1; high[i] = i * 2; } return low.length + "," + high.length + "," + low[m - 1] + "," + high[m - 1]; }
function oneHoldsSomething(n) { const m = n | 0, low = [], high = [7]; for (let i = 0; i < m; i++) { low[i] = i & 1; high[i] = i * 2; } return low.length + "," + high.length + "," + high[0]; }
function three(n) { const m = n | 0, a = [], b = [], c = []; for (let i = 0; i < m; i++) { a[i] = i; b[i] = i + 0.5; c[i] = -i; } return a.length + b.length + c.length + a[m >> 1] + b[m >> 1] + c[m >> 1]; }
function oneIsPushedOnto(n) { const m = n | 0, a = [], b = []; for (let i = 0; i < m; i++) { a[i] = i; b.push(i & 3); } return a.length + "," + b.length + "," + b[m - 1]; }
const said = [];
for (const n of [0, 1, 2, 5, 6, 9, 10, 25, 26, 64, 65, 300]) said.push(two(n), oneHoldsSomething(n), three(n), oneIsPushedOnto(n));
console.log(said.join(" "));
