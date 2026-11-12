// Loops that take bits alone of elements and run no other code: their keys count past the ends of their arrays, below zero, by halves and out of the range of array indices.
var lib = { tables: [[], []] };
function rounds(k, n, a, b) { var t = lib.tables[0], u = lib.tables[1], p = 4, m, e, f; for (m = 0; m < n; m++) { e = t[a >>> 24] ^ u[b >> 16 & 255] ^ t[a >> 8 & 255] ^ k[p]; f = u[b >>> 24] ^ t[a & 255] ^ u[b >> 8 & 255] ^ k[p + 1]; a = e ^ k[p + 2] >>> 1; b = f ^ k[p + 3] << 3; p += 4; } return [a, b, p].join(); }
function down(k, n, a) { var t = lib.tables[0], p = 9, m; for (m = 0; m < n; m++) { a = t[a >>> 24] ^ t[a >> 16 & 255] ^ t[a >> 8 & 255] ^ t[a & 255] ^ k[p] ^ k[p + 1] >>> 3 ^ a << 5; a = a ^ t[a & 255] ^ a >>> 7; p -= 3; } return [a, p].join(); }
function doubled(k, n, a) { var t = lib.tables[1], p = 1, m; for (m = 0; m < n; m++) { a = t[a >>> 24] ^ t[a >> 16 & 255] ^ t[a >> 8 & 255] ^ t[a & 255] ^ k[p] ^ k[p + 2] >>> 3 ^ a << 5; a = a ^ t[a & 255] ^ a >>> 7; p = p * 2 + 3; } return [a, p].join(); }
function far(k, n, a) { var t = lib.tables[1], p = 0, m; for (m = 0; m < n; m++) { a = t[a >>> 24] ^ t[a >> 16 & 255] ^ t[a >> 8 & 255] ^ t[a & 255] ^ k[p] ^ k[p + 3000] >>> 3 ^ a << 5; a = a ^ t[a & 255] ^ a >>> 7; p += 5; } return [a, p].join(); }
function halves(k, n, a, s) { var t = lib.tables[0], p = 2, m; for (m = 0; m < n; m++) { a = t[a >>> 24] ^ t[a >> 16 & 255] ^ t[a >> 8 & 255] ^ t[a & 255] ^ k[p] ^ a << 5; a = a ^ t[a & 255] ^ a >>> 7; p += s; } return [a, p].join(); }
function counted(k, n, a) { var t = lib.tables[0], p = 0, q = 0, m; for (m = 0; m < n; m++) { a = t[a >>> 24] ^ t[a >> 16 & 255] ^ k[p] ^ k[q + 1] << 2 ^ a >>> 3; a = a ^ t[a & 255] ^ a << 7; if (a & 1) p += 3; else q += 2; } return [a, p, q].join(); }
"undefined" !== typeof module && module.exports && (module.exports = lib);
for (let t = 0; t < 2; t++) for (let i = 0; i < 256; i++) lib.tables[t][i] = t ? (i * 0x9e3779b9) >>> 0 : Math.imul(i * 5 + 1, 0x85ebca6b) | 0;
const base = (n, s) => Array.from({ length: n }, (_, i) => Math.imul(i + s, 0x9e3779b9) | 0);
const warm = base(64, 3), long = base(4000, 5);
for (let i = 0; i < 400; i++) { rounds(warm, 12, i, 7); down(warm, 3, i); doubled(warm, 4, i); far(long, 12, i); halves(warm, 20, i, 1); counted(warm, 20, i); }
const lists = { ints: base(44, 1), uints: base(44, 2).map(v => v >>> 0), doubles: base(44, 3).map(v => v + .5), short: base(7, 4), one: [7], none: [], holes: (x => (delete x[9], delete x[17], x))(base(44, 5)), holesOfDoubles: (x => (delete x[6], x))(base(44, 6).map(v => v + .25)), boxed: (x => (x[5] = "12", x))(base(44, 7)), undef: (x => (x[8] = undefined, x))(base(44, 8)), bigs: base(44, 9).map(v => BigInt(v)), frozen: Object.freeze(base(44, 10)), names: Object.assign(base(44, 11), { "-1": 5, "-3": 9, 4294967295: 8, 4294967296: 3, 2.5: 11 }), inherits: Object.setPrototypeOf(base(20, 12), { __proto__: Array.prototype, 25: 4, "-2": 8 }), words: Int32Array.from(base(44, 13)), object: Object.assign({}, base(44, 14)), text: "0123456789", long, longDoubles: base(4000, 6).map(v => v / 3) };
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s); };
const run = (n, f) => { let r; try { r = f(); } catch (e) { r = e.name; } note(n, r); };
for (const name of Object.keys(lists)) {
  const l = lists[name];
  for (const n of [0, 1, 3, 10, 13, 60]) { run(name + " rounds " + n, () => rounds(l, n, 0x1fac2c99, -5)); run(name + " down " + n, () => down(l, n, 77)); run(name + " doubled " + n, () => doubled(l, n, 2 ** 31)); run(name + " far " + n, () => far(l, n, 9)); run(name + " counted " + n, () => counted(l, n, -9)); for (const s of [1, .5, -1, 2 ** 30, "1", -0]) run(name + " halves " + n + " " + s, () => halves(l, n, 5, s)); }
}
console.log(all, rounds(warm, 12, 1, 7), down(warm, 3, 1), doubled(warm, 4, 1), far(long, 12, 1), halves(warm, 20, 1, 1), counted(warm, 20, 1));
