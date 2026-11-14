"use strict";
function f0(o, n, x, y) { const s0 = o.s; const p = o.p;const q = o.q;const r = o.r;const k = o.k; let a = x ^ y;let b = x; let pos = n - 2; const out = o.out; let m; for (m = 0; m < n; m++) { const na = a ^ k[m] ^ r[a >>> 28]; const nb = k[pos] ^ p[b >>> 28] ^ 0x1b; a = na; b = nb; pos += 4; } return [a, b, pos, m].map(String).join(); }
function f1(o, n, x, y) { const s0 = o.s; const p = o.p;const q = o.q;const r = o.r;const k = o.k; let a = x ^ y;let b = y; let pos = y & 7; const out = o.out; let m; for (m = 0; m < (o.k.length >> 2); m++) { const na = r[b & 15] ^ r[a >> 24 & 15] ^ r[a >>> 28] ^ -1 ^ (b >> (k[pos] >>> 1)); const nb = m ^ b ^ k[pos + 2]; a = na; b = nb; pos += 3; touch(o, m); } return [a, b, pos, m].map(String).join(); }
function f2(o, n, x, y) { const s0 = o.s; const p = o.p;const q = o.q;const r = o.r;const k = o.k; let a = x ^ y;let b = y;let c = y; let pos = 0; const out = o.out; let m; for (m = 0; m < n; m++) { const na = m ^ k[pos + 3] ^ k[m] ^ (x << 31) ^ (p[c >>> 4 & 15] | 0); const nb = k[pos + 3] ^ k[pos + 2] ^ k[pos + 3] ^ q[a & 7]; const nc = r[a & 31] ^ k[pos] ^ q[b >>> 4 & 15] ^ q[c >>> 4 & 15]; a = na; b = nb; c = nc; pos = pos + 4; } return [a, b, c, pos, m].map(String).join(); }

let writes = 0; function touch(o, m) { writes++; if (writes % 7 === 0) o.p[m & 7] = writes; if (writes % 29 === 0) o.q[3] = .25; if (writes % 53 === 0) o.k.length = 9; }
const base = (k) => Array.from({ length: 16 }, (_, i) => Math.imul(i * 7 + k, 0x9e3779b9) | 0);
const kinds = {
  ints: base, small: (k) => base(k).map((v) => v & 7), doubles: (k) => base(k).map((v) => v + .5), uints: (k) => base(k).map((v) => v >>> 0), far: (k) => base(k).map((v) => v * 4294967297 * 8),
  infinite: (k) => { const x = base(k).map((v) => v + .25); x[3] = Infinity; x[4] = -0; x[5] = -Infinity; return x; }, nan: (k) => { const x = base(k).map((v) => v + .25); x[2] = NaN; return x; }, tiny: (k) => base(k).map((v) => v * 5e-324), zeros: (k) => base(k).map((v, i) => i & 1 ? -0 : 0),
  holes: (k) => { const x = base(k); delete x[3]; delete x[9]; return x; }, holesOfDoubles: (k) => { const x = base(k).map((v) => v + .5); delete x[3]; delete x[9]; return x; }, short: (k) => base(k).slice(0, 5), shortDoubles: (k) => base(k).map((v) => v >>> 0).slice(0, 5), long: (k) => base(k).concat(base(k + 1), base(k + 2)), longDoubles: (k) => base(k).concat(base(k + 1)).map((v) => v >>> 0),
  texts: (k) => { const x = base(k); x[2] = "5"; return x; }, boxed: (k) => { const x = base(k); x[1] = "q"; x[1] = 4; return x; }, undef: (k) => { const x = base(k); x[4] = undefined; return x; },
  frozen: (k) => Object.freeze(base(k)), sealed: (k) => Object.seal(base(k).map((v) => v + .5)), getter: (k) => { const x = base(k); Object.defineProperty(x, 1, { get() { return 3; }, set(v) { writes += 1; }, configurable: true }); return x; },
  inherits: (k) => { const x = base(k); Object.setPrototypeOf(x, { __proto__: Array.prototype, 3: 77 }); delete x[3]; return x; }, heir: (k) => { class A extends Array {} return A.from(base(k)); },
  bytes: (k) => Uint8Array.from(base(k)), words: (k) => Int32Array.from(base(k)), floats: (k) => Float64Array.from(base(k)), object: (k) => Object.assign({}, base(k)), text: (k) => "0123456789abcdef", literal: (k) => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], literalOfDoubles: (k) => [1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  bigs: (k) => { const x = base(k); x[5] = 3n; return x; }, allBigs: (k) => base(k).map((v) => BigInt(v)), objects: (k) => { const x = base(k); x[6] = { valueOf() { writes++; return 2; } }; return x; }, none: (k) => [], nothing: (k) => undefined,
};
const names = Object.keys(kinds), fs = [f0, f1, f2];
const words = [5, -7, 0x9f216bee, 2 ** 31, -(2 ** 31), 2 ** 32 + 5, 2 ** 53, 1.5, -0, NaN, Infinity, undefined, null, "12", 7n, 2 ** 31 - 1];
let all = 0;
function show(x) { return x === undefined || x === null || typeof x !== "object" ? String(x) : Array.from({ length: 17 }, (_, i) => { const d = Object.getOwnPropertyDescriptor(x, i); return d ? ("value" in d ? typeof d.value === "object" && d.value ? "o" : String(d.value) : "g") : "-"; }).join() + x.length; }
function run(f, name, o, n, x, y) { let r; try { r = f(o, n, x, y); } catch (e) { r = e.name; } const p = r + "|" + show(o.p) + "|" + show(o.q) + "|" + show(o.r) + "|" + show(o.k) + "|" + show(o.out) + "|" + writes; let h = 0; for (let i = 0; i < p.length; i++) h = Math.imul(h, 31) + p.charCodeAt(i) | 0; all = Math.imul(all, 17) + h | 0; console.log(name, p.slice(0, 70), h); }
for (let j = 0; j < fs.length; j++) for (let a = 0; a < names.length; a++) {
  const p = kinds[names[a]](j), q = kinds[names[(a * 3 + j) % names.length]](j + 1), r = kinds[names[(a * 5 + 7) % names.length]](j + 2), w = words[(a + j) % words.length], v = words[(a * 3 + j) % words.length];
  run(fs[j], names[a] + j, { p, q, r, k: kinds.longDoubles(j), w, v, s: 4, out: [0, 0, 0, 0] }, 5, 0x12345678 + j, a);
  run(fs[j], names[a] + j + "n", { p: kinds.ints(j), q: kinds.ints(a), r: kinds.ints(3), k: p, w: 5, v: 6, s: 0, out: [0, 0, 0, 0] }, 8, a * 0x9e3779b1 | 0, 3);
  run(fs[j], names[a] + j + "k", { p: kinds.uints(j), q: kinds.ints(a), r: kinds.long(3), k: kinds.ints(a), w: -5, v: 2 ** 31, s: 2 ** 32 - 3, out: [.5, 0, 0, 0] }, 30, a, 0);
  run(fs[j], names[a] + j + "s", { p, q: p, r: p, k: p, w, v, s: w, out: p }, 6, w, v);
}
console.log(all);

