// Schedules read under p, p + 1, p + 2, p + 3 and under keys that may be negative, inside, across and past their ends; arrays that a loop fills to its bound.
var lib = { tables: [[], [], [], []], hook: null };
function rounds(k, n, p, a, b, c, d) { var t = lib.tables[0], u = lib.tables[1], v = lib.tables[2], w = lib.tables[3], e, f, g, h, m; for (m = 0; m < n; m++) { e = t[a >>> 24] ^ u[b >> 16 & 255] ^ v[c >> 8 & 255] ^ w[d & 255] ^ k[p]; f = t[b >>> 24] ^ u[c >> 16 & 255] ^ v[d >> 8 & 255] ^ w[a & 255] ^ k[p + 1]; g = t[c >>> 24] ^ u[d >> 16 & 255] ^ v[a >> 8 & 255] ^ w[b & 255] ^ k[p + 2]; h = t[d >>> 24] ^ u[a >> 16 & 255] ^ v[b >> 8 & 255] ^ w[c & 255] ^ k[p + 3]; p += 4; a = e; b = f; c = g; d = h; } return [a, b, c, d, p].map(String).join(); }
function signed(f, g, x, n) { var i, y = x | 0, z = 0; for (i = 0; i < n; i++) { y = Math.imul(y, 0x9e3779b9) + i | 0; z = z ^ g[f[y >>> 28]] ^ f[y >> 28] ^ g[y >> 29] ^ f[(y >> 24) - 4] ^ g[f[y >> 8 & 15] ^ 3] ^ y >>> 7 ^ z << 3; } return z; }
function fill(a, n) { var d = a.slice(0), b = a.length, c = 1, i; lib.kept = d; for (i = b; i < n; i++) { c = c << 1 ^ d[i - 1] ^ (d[i - b] >>> 3 | 0) ^ i * 7 ^ c >>> 5; d[i] = c; } return d; }
function drain(a, n) { var e = [], b, c; lib.kept = e; for (b = 0; n; b++, n--) { c = a[n & 3]; e[b] = n & 4 ? c : c ^ n << 3 ^ c >>> 9 ^ b * 5 ^ a[b & 3] << 1 ^ a[n & 1] >> 2 ^ 0x55; } return e; }
"undefined" !== typeof module && module.exports && (module.exports = lib);
for (let t = 0; t < 4; t++) for (let i = 0; i < 256; i++) lib.tables[t][i] = Math.imul(i * 5 + t, 0x85ebca6b) ^ t;
function show(x) { if (!Array.isArray(x)) return String(x); let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : String(x[i])) + " " : "- "; return s + x.length; }
const base = (n, s) => Array.from({ length: n }, (_, i) => Math.imul(i + s, 0x9e3779b9) | 0);
const lists = { ints: base(44, 1), uints: base(44, 2).map(v => v >>> 0), doubles: base(44, 3).map(v => v + .5), short: base(13, 4), one: [7], none: [], holes: (x => (delete x[9], delete x[17], x))(base(44, 5)), holesOfDoubles: (x => (delete x[6], x))(base(44, 6).map(v => v + .25)), boxed: (x => (x[5] = "12", x))(base(44, 7)), undef: (x => (x[8] = undefined, x))(base(44, 8)), bigs: base(44, 9).map(v => BigInt(v)), frozen: Object.freeze(base(44, 10)), names: Object.assign(base(44, 11), { "-1": 5, "-3": 9, 4294967296: 3 }), inherits: Object.setPrototypeOf(base(20, 12), { __proto__: Array.prototype, 25: 4, "-2": 8 }), words: Int32Array.from(base(44, 13)), object: Object.assign({}, base(44, 14)), small: base(44, 15).map(v => v & 15), negative: base(44, 16).map(v => v >> 28) };
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 90 ? s.slice(0, 60) + s.slice(-30) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
for (const name of Object.keys(lists)) {
  const l = lists[name];
  for (const [n, p] of [[9, 4], [11, 0], [10, 4], [3, 40], [2, 43], [5, -2], [2, 2 ** 31 - 3], [2, 2 ** 32 - 6], [2, 2 ** 53 - 2], [3, .5], [1, "4"], [2, 4]]) run(name + " rounds " + n + " " + p, () => rounds(l, n, p, 0x1fac2c99, -5, 7, 2 ** 31));
  run(name + " signed", () => signed(lists.small, l, 5, 60)); run(name + " signed of", () => signed(l, lists.ints, -9, 60)); run(name + " signed names", () => signed(lists.negative, l, 77, 60));
  for (const n of [l.length | 0, 20, 60, 200, -1, 30.5, "50"]) run(name + " fill " + n, () => fill(l, n));
  for (const n of [0, 1, 7, 60, 300, 12n, "9"]) run(name + " drain " + n, () => drain(l, n));
}
console.log(all);
