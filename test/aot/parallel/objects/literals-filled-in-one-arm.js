// Literals that a loop fills out of one object of one layout: { ...d, c: i } over a constant, kept, pushed, passed, with getters, symbols and orders of keys.
"use strict";
const log = [];
const show = o => Object.keys(o).map(k => k + "=" + (typeof o[k] === "object" && o[k] ? "{" + Object.keys(o[k]) + "}" : String(o[k]))).join(",") + "|" + JSON.stringify(o) + "|" + Object.getOwnPropertySymbols(o).length;
const d = { a: 1, b: 2 }, e = { b: 5, a: 6, c: 7 }, none = {}, mark = Symbol("mark"), marked = { a: 1, [mark]: 2 }, got = { get a() { return 4; }, b: 1 }, frozen = Object.freeze({ a: 9, b: 8 });
let last, changing = { a: 1, b: 2 };
function sum(n) { let s = 0; for (let i = 0; i < n; i++) { const x = { ...d, c: i }; s += x.a + x.c; } return s; }
function keep(n) { let s = 0; for (let i = 0; i < n; i++) { const x = { ...d, c: i }; last = x; s += x.c; } return s + show(last); }
function push(n) { const out = []; for (let i = 0; i < n; i++) out.push({ ...d, c: i }); return out.map(show).join(";"); }
function before(n) { const out = []; for (let i = 0; i < n; i++) out.push({ c: i, ...d }); return out.map(show).join(";"); }
function over(n) { const out = []; for (let i = 0; i < n; i++) out.push({ ...e, a: i, ...d }); return out.map(show).join(";"); }
function pass(o, n) { let out = []; for (let i = 0; i < n; i++) out.push({ z: i, ...o, c: i }); return out.map(show).join(";"); }
function change(n) { const out = []; for (let i = 0; i < n; i++) { out.push({ ...changing, i }); if (i === 1) changing.x = 5; if (i === 3) changing = { b: 1 }; if (i === 4) changing = null; if (i === 5) changing = { get a() { changing = { q: 1 }; return 3; } }; } return out.map(show).join(";"); }
function nested(n) { const out = []; for (let i = 0; i < n; i++) out.push({ ...d, in: { ...e, i }, c: i }); return out.map(show).join(";"); }
for (let turn = 0; turn < 3; turn++) {
  log.push(sum(5), keep(4), push(3), before(3), over(3), nested(3));
  for (const o of [d, e, none, marked, got, frozen, null, undefined, 7, "ab", [1, 2], Object.create({ a: 1 }, { b: { value: 2, enumerable: true }, h: { value: 3 } }), new Proxy({ a: 1 }, { ownKeys: () => ["a"], getOwnPropertyDescriptor: () => ({ value: 5, enumerable: true, configurable: true }) })]) log.push(pass(o, 2));
  changing = { a: 1, b: 2 }; log.push(change(8));
}
d.a = 10; log.push(sum(5), push(2)); d.x = 3; log.push(sum(5), push(2)); delete d.a; log.push(sum(5), push(2));
for (const line of log) console.log(line);
