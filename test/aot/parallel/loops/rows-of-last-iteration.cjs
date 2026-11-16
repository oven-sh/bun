// Tables whose cells are computed from the cell before: subsequences, edit distances, grids, with stores in both arms and rows that are one array.
function common(dp, s, u) { for (let i = 1; i <= s.length; i++) for (let j = 1; j <= u.length; j++) { if (s[i - 1] === u[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1; else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]); } return dp; }
function distance(prev, cur, s, u) { for (let i = 1; i <= s.length; i++) { cur[0] = i; for (let j = 1; j <= u.length; j++) { if (s[i - 1] === u[j - 1]) cur[j] = prev[j - 1]; else cur[j] = Math.min(prev[j], cur[j - 1], prev[j - 1]) + 1; } const t = prev; prev = cur; cur = t; } return prev; }
function paths(grid, n) { for (let i = 1; i < grid.length; i++) for (let j = 1; j < n; j++) { if (grid[i][j] < 0) grid[i][j] = 0; else grid[i][j] = grid[i - 1][j] + grid[i][j - 1]; } return grid; }
function arms(d, a, n) { for (let i = 1; i < n; i++) { if (a[i] & 1) d[i] = a[i]; else if (a[i] & 2) d[i] = d[i - 1] * .5; else { d[i] = d[i - 1] + 1; if (a[i] === 4) a[i - 1] = 9; } } return d; }
function last(d, a, n) { for (let i = n - 2; i >= 0; i--) { if (a[i] > 3) d[i] = d[i + 1] + a[i]; else d[i] = -d[i + 1]; } return d; }
function show(x) { if (Array.isArray(x) && x.some(Array.isArray)) return x.map(show).join("/"); if (x === null || typeof x !== "object") return String(x); let s = ""; for (let i = 0; i < Math.min(x.length, 20); i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : typeof x[i] === "object" ? "o" : String(x[i])) + " " : "- "; return s + x.length; }
const base = (k, n = 12) => Array.from({ length: n }, (_, i) => (i * 7 + k) % 11);
const rows = {
  zeros: () => new Array(12).fill(0), halves: () => new Array(12).fill(.5), ints: k => base(k), doubles: k => base(k).map(v => v + .25), big: k => base(k).map(v => v + 2147483643), empty: () => new Array(12), none: () => [], short: () => [1, 2], negative: k => base(k).map(v => v - 5), zero: () => [0, -0, 0, -0, 0, -0, 0, 0, 0, 0, 0, 0],
  holes: k => { const x = base(k); delete x[0]; delete x[5]; return x; }, nan: k => { const x = base(k).map(v => v + .5); x[0] = NaN; return x; }, boxed: k => { const x = base(k); x[4] = "q"; x[4] = 4; return x; }, texts: k => { const x = base(k); x[3] = "7"; return x; }, undef: k => { const x = base(k); x[0] = undefined; return x; },
  frozen: k => Object.freeze(base(k)), getter: k => Object.defineProperty(base(k), 3, { get() { return 6; }, set() { }, configurable: true }), heir: k => (class extends Array { }).from(base(k)), inherits: k => { const x = base(k); delete x[2]; return Object.setPrototypeOf(x, { __proto__: Array.prototype, 2: 40 }); },
  words: k => Int32Array.from(base(k)), floats: k => Float64Array.from(base(k)), bytes: k => Uint8Array.from(base(k)), proxy: k => new Proxy(base(k), {}), object: () => ({ 0: 3, 1: 1, length: 4 }),
};
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 150 ? s.slice(0, 100) + s.slice(-50) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
const names = Object.keys(rows), s = base(2, 5), u = base(5, 9);
for (const turn of [1, 2, 3]) for (const name of names) {
  const row = rows[name], other = rows[names[(names.indexOf(name) + turn * 5) % names.length]];
  run("common " + name, () => common(Array.from({ length: 6 }, (_, i) => row(i)), s, u)); run("common beside " + name, () => common([row(1), other(2), row(3), other(4), row(5), other(6)], s, u));
  const same = row(4); run("common same " + name, () => common([same, same, same, same, same, same], s, u)); run("common two " + name, () => { const two = other(3); return common([same, two, same, two, same, two], s, u); });
  run("distance " + name, () => distance(row(1), other(2), s, u)); run("distance same " + name, () => { const d = row(1); return distance(d, d, s, u); });
  run("paths " + name, () => paths([row(1), row(2), other(3), row(4)], 10)); run("paths same " + name, () => { const d = row(2); return paths([d, d, d], 11); });
  run("arms " + name, () => arms(row(1), base(3), 11)); run("arms of " + name, () => arms(base(1), row(3), 11)); run("arms same " + name, () => { const d = row(1); return arms(d, d, 11); });
  run("last " + name, () => last(row(turn), base(4), 11)); run("last of " + name, () => last(base(1), row(turn), 11)); run("last same " + name, () => { const d = row(turn); return last(d, d, 11); });
}
console.log(all);
