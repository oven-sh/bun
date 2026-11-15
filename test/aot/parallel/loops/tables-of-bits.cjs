// Tables that loops look bits up in under masked keys: int32s, doubles, holes, boxed values, mixed, and tables that change between two runs.
function crc(t, a) { let c = -1; for (let i = 0; i < a.length; i++) c = c >>> 8 ^ t[(c ^ a[i]) & 255] ^ i; return c; }
function rounds(t, u, v, w, k, n, a, b) { let c = a ^ b, d = a + b | 0, p = 0; for (let m = 0; m < n; m++) { const e = t[a >>> 24] ^ u[b >> 16 & 255] ^ v[c >> 8 & 255] ^ w[d & 255] ^ k[p]; const f = t[b >>> 24] ^ u[c >> 16 & 255] ^ v[d >> 8 & 255] ^ w[a & 255] ^ k[p + 1]; p += 2; a = e; b = f; c = c ^ e << 1; d = d + f | 0; } return [a, b, c, d].join(); }
function boxes(s, t, a, n) { let z = 0; for (let i = 0; i < n; i++) { a = Math.imul(a, 0x9e3779b9) + i | 0; z = z ^ t[s[a >>> 28] & 15] ^ t[s[a & 15]] ^ s[a >> 4 & 15] << 4 ^ a >>> 7; } return z; }
function copies(d, t, n) { const e = []; for (let b = 0; n; b++, n--) { const c = d[b & 3 ? n : n - 4]; e[b] = 4 >= n || 4 > b ? c : t[c >>> 24] ^ t[c >> 16 & 255] ^ t[c & 255]; } return e; }
function joins(d, n, x) { const e = d.slice(0); for (let i = 0; i < n; i++) { let c; if (i & 1) c = d[i]; else if (i & 2) c = d[i] * x; else c = d[i] ^ i; e[i] = c; } return e; }
function chosen(d, e, n, x) { for (let i = 0; i < n; i++) e[i] = i & 1 ? d[n - 1 - i] : d[i] - x; return e; }
function show(x) { if (!Array.isArray(x)) return String(x); let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : String(x[i])) + " " : "- "; return s + x.length; }
const base = (k, n = 256) => Array.from({ length: n }, (_, i) => Math.imul(i * 5 + k, 0x85ebca6b) ^ k);
const tables = {
  ints: k => base(k), uints: k => base(k).map(v => v >>> 0), doubles: k => base(k).map(v => v + .5), mixed: k => base(k).map((v, i) => i & 1 ? v : v >>> 0), small: k => base(k).map(v => v & 15), smallDoubles: k => base(k).map(v => (v & 15) + .25), short: k => base(k, 40), none: () => [],
  holes: k => { const x = base(k); delete x[7]; delete x[200]; return x; }, holesOfDoubles: k => { const x = base(k).map(v => v + .5); delete x[3]; return x; }, nan: k => { const x = base(k).map(v => v + .5); x[9] = NaN; return x; }, big: k => base(k).map(v => v * 2 ** 20), boxed: k => { const x = base(k); x[4] = "q"; x[4] = 4; return x; }, texts: k => { const x = base(k); x[3] = "7"; return x; }, undef: k => { const x = base(k); x[0] = undefined; return x; }, bigints: k => base(k).map(v => BigInt(v)),
  frozen: k => Object.freeze(base(k)), getter: k => Object.defineProperty(base(k), 3, { get() { return 6; } }), heir: k => (class extends Array { }).from(base(k)), inherits: k => { const x = base(k); delete x[2]; return Object.setPrototypeOf(x, { __proto__: Array.prototype, 2: 40 }); }, later: k => { const x = base(k); x[5] = .5; x[5] = 5; return x; },
  words: k => Int32Array.from(base(k)), unsigned: k => Uint32Array.from(base(k)), floats: k => Float64Array.from(base(k)), bytes: k => Uint8Array.from(base(k)), text: () => "0123456789", object: () => ({ 0: 3, 1: 1, length: 4 }), nothing: () => undefined,
};
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 120 ? s.slice(0, 80) + s.slice(-40) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
const names = Object.keys(tables);
for (const turn of [1, 2, 3]) for (const name of names) {
  const t = tables[name], o = tables[names[(names.indexOf(name) + turn * 7) % names.length]];
  run("crc " + name, () => crc(t(turn), base(3, 40))); run("crc of " + name, () => crc(tables.ints(2), t(turn)));
  run("rounds " + name, () => rounds(t(1), t(2), t(3), t(4), base(5, 60), 30, 0x1fac2c99, -5)); run("rounds one " + name, () => rounds(tables.ints(1), tables.ints(2), t(3), tables.ints(4), o(5), 12, turn, 7)); run("rounds keys " + name, () => rounds(tables.ints(1), tables.ints(2), tables.uints(3), tables.ints(4), t(5), 20, turn, -9)); run("rounds both " + name, () => rounds(t(1), o(2), t(3), o(4), base(6, 60).map(v => v >>> 0), 25, 77, -1));
  run("boxes " + name, () => boxes(tables.small(1), t(2), turn, 50)); run("boxes of " + name, () => boxes(t(1), tables.ints(2), turn, 50)); run("boxes both " + name, () => boxes(tables.small(3), o(2), 9, 50));
  run("copies " + name, () => copies(t(turn), tables.ints(2), 40)); run("copies of " + name, () => copies(tables.uints(1), t(2), 44)); run("copies doubles " + name, () => copies(tables.doubles(1), t(2), 44)); run("copies few " + name, () => copies(t(1), t(2), 3));
  for (const x of [2, NaN, Infinity, -0]) { run("joins " + name + x, () => joins(t(turn), 20, x)); run("chosen " + name + x, () => chosen(t(1), tables.doubles(2).slice(0, 30), 20, x)); run("chosen into " + name + x, () => chosen(tables.doubles(1), t(2), 20, x)); }
  const changed = t(6); run("crc before " + name, () => crc(changed, base(3, 30))); run("change " + name, () => { changed[7] = turn === 1 ? .5 : turn === 2 ? "x" : 2 ** 40; return 1; }); run("crc behind " + name, () => crc(changed, base(3, 30)));
}
console.log(all);
