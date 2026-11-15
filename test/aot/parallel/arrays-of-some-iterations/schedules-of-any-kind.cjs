"use strict";
function f0(o, n, x, y) { const a = o.p, f = o.f, g = o.g; let b = a.length, c, h = 1, m = 0; let d = a.slice(); const e = []; o.kept = [d, e]; let i; for (i = a.length; i < b + 9; i++, m++) { if (m > 40) break; c = d[0]; if (x & 1 || 5 < i) { c = f[c & 15] + 1;  } d[i + 1] = d[m & 3] + 1; if (m === 5) touch(o, d); } o.d = d; o.e = e; return [c, h, i, m].map(String).join(); }
function f1(o, n, x, y) { const a = o.p, f = o.f, g = o.g; let b = a.length | 0, c, h = 1, m = 0; let d = a.slice(0); const e = [];  let i; for (i = a.length; i < 4 * b + 6; i++, m++) { if (m > 40) break; c = d[m & 3]; if (x & 1 || 5 < i) { c = g[0][f[c >>> 28] & 15] ^ g[1][f[c & 15] & 15]; c = c ^ h; } d[i] = (c << 8 ^ c >>> 24) ^ d[m & 3]; } o.d = d; o.e = e; return [c, h, i, m].map(String).join(); }
function f2(o, n, x, y) { const a = o.p, f = o.f, g = o.g; let b = 4, c, h = 1, m = 0; let d = a; const e = [];  let i; for (i = 0; i < 4 * b + 6; i++, m++) { if (m > 40) break; c = d[i - 2]; if (0 === i % b) { c = f[c & 15] + 1; h = h << 1 ^ 283 * (h >> 7); } d[i] = ~d[0]; } o.d = d; o.e = e; return [c, h, i, m].map(String).join(); }

let writes = 0, hold; function touch(o, d) { writes++; if (writes % 3 === 0) o.f = [1, 2]; if (writes % 5 === 0) d.length = 2; if (writes % 7 === 0) Object.freeze(d); if (writes % 11 === 0) d[1] = "z"; }
const base = (k, n = 6) => Array.from({ length: n }, (_, i) => Math.imul(i * 7 + k, 0x9e3779b9) | 0);
class Heir extends Array { slice(...r) { writes++; return super.slice(...r); } }
class Other extends Array { static get [Symbol.species]() { return Array; } }
const kinds = {
  ints: (k) => base(k), four: (k) => base(k, 4), eight: (k) => base(k, 8), doubles: (k) => base(k).map((v) => v + .5), uints: (k) => base(k).map((v) => v >>> 0), written: (k) => [1, 2, 3, 4], writtenDoubles: (k) => [2654435769, 1.5, 3, 4, 5, 6], one: (k) => [7], none: (k) => [],
  holes: (k) => { const x = base(k); delete x[1]; delete x[4]; return x; }, holesOfDoubles: (k) => { const x = base(k).map((v) => v + .5); delete x[1]; return x; }, nan: (k) => { const x = base(k).map((v) => v + .25); x[2] = NaN; return x; }, zeros: (k) => [0, -0, 0, -0],
  texts: (k) => { const x = base(k); x[2] = "5"; return x; }, boxed: (k) => { const x = base(k); x[1] = "q"; x[1] = 4; return x; }, undef: (k) => { const x = base(k); x[3] = undefined; return x; }, bigs: (k) => { const x = base(k); x[2] = 3n; return x; }, objects: (k) => { const x = base(k); x[2] = { valueOf() { writes++; return 2; } }; return x; },
  frozen: (k) => Object.freeze(base(k)), sealed: (k) => Object.seal(base(k)), stopped: (k) => Object.preventExtensions(base(k)), getter: (k) => { const x = base(k); Object.defineProperty(x, 1, { get() { return 3; }, set(v) { writes += 1; }, configurable: true }); return x; }, readonly: (k) => Object.defineProperty(base(k), "length", { writable: false }),
  heir: (k) => Heir.from(base(k)), other: (k) => Other.from(base(k)), inherits: (k) => { const x = base(k); Object.setPrototypeOf(x, { __proto__: Array.prototype, 7: 77, set 8(v) { writes++; } }); return x; },
  words: (k) => Int32Array.from(base(k)), floats: (k) => Float64Array.from(base(k)), text: (k) => "01234567", nothing: (k) => undefined, arguments: function (k) { return arguments; }, proxy: (k) => new Proxy(base(k), { set(o, k, v) { writes++; o[k] = v; return true; } }),
};
const tables = { ints: () => base(3, 16), doubles: () => base(3, 16).map((v) => v >>> 0), holes: () => { const x = base(3, 16); delete x[5]; return x; }, short: () => base(3, 5), small: () => base(3, 16).map((v) => v & 255), nothing: () => undefined, none: () => [], object: () => ({ 3: 4 }), boxed: () => { const x = base(3, 16); x[2] = "x"; return x; }, view: () => Uint8Array.from(base(3, 16)) };
const names = Object.keys(kinds), tableNames = Object.keys(tables), fs = [f0, f1, f2];
let all = 0;
function show(x) { return x === undefined || x === null || typeof x !== "object" ? String(x) : Array.from({ length: 24 }, (_, i) => { const d = Object.getOwnPropertyDescriptor(x, i); return d ? ("value" in d ? (Object.is(d.value, -0) ? "-0" : typeof d.value === "object" && d.value ? "o" : String(d.value)) : "g") : "-"; }).join() + x.length; }
function run(f, name, o, n, x, y) { let r; try { r = f(o, n, x, y); } catch (e) { r = e.name; } const p = r + "|" + show(o.p) + "|" + show(o.d) + "|" + show(o.e) + "|" + show(o.kept && (Array.isArray(o.kept[0]) ? o.kept[0] : o.kept)) + "|" + writes; let h = 0; for (let i = 0; i < p.length; i++) h = Math.imul(h, 31) + p.charCodeAt(i) | 0; all = Math.imul(all, 17) + h | 0; console.log(name, p.slice(0, 80), h); }
for (let j = 0; j < fs.length; j++) for (let a = 0; a < names.length; a++) {
  const g = [base(1, 16), base(2, 16)], f = tables[tableNames[(a + j) % tableNames.length]]();
  run(fs[j], names[a] + j, { p: kinds[names[a]](j), q: kinds[names[(a * 3 + 1) % names.length]](2), f: tables.ints(), g }, 16, 0x12345678 + j, a);
  run(fs[j], names[a] + j + "f", { p: kinds.four(j), q: [], f, g: a & 1 ? g : [f, f] }, 20, a, 3);
  run(fs[j], names[a] + j + "u", { p: kinds[a & 1 ? "uints" : "ints"](a), q: kinds[names[a]](1), f: tables.small(), g }, 12, a * 1.5, 2 ** 31);
  run(fs[j], names[a] + j + "s", { p: kinds[names[a]](a), q: kinds.ints(3), f: kinds[names[a]](3), g: [kinds[names[a]](1), f] }, 18, -7, "4");
}
console.log(all, writes);

