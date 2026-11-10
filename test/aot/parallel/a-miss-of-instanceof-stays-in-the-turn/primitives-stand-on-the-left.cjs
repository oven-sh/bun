// A helper copied in line tells three classes apart in a loop. Numbers, a text, null, undefined, a symbol, a big integer and a boolean stand among the instances: none of them is an instance of anything.
// STATISTIC: MissesOfInstanceOfThatStayInTheTurn >= 1
"use strict";
class Circle { constructor(d) { this.r = d.r; } }
class Rect { constructor(d) { this.w = d.w; this.h = d.h; } }
class Tri { constructor(d) { this.w = d.w; this.h = d.h; this.k = 1; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ r: i % 5 + 1, w: i % 4 + 1, h: i % 6 + 2 }))));
const makers = new Map([[0, Circle], [1, Rect], [2, Tri]]);
const all = rows.map((d, i) => new (makers.get(i % 3))(d));
let hits = 0, thrown = 0;
all[1] = 5; all[2] = 'text'; all[4] = null; all[5] = undefined; all[7] = Symbol('s'); all[8] = 10n; all[10] = true; all[11] = 1.5;
function g(s) { return s instanceof Circle ? (s.r ?? 100) : s instanceof Rect ? (s.w ?? 200) : s instanceof Tri ? (s.h ?? 300) : 7; }
function f(t) { let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) {  sum = (sum + f(t)) % 1000003; } console.log(sum, hits, thrown);
