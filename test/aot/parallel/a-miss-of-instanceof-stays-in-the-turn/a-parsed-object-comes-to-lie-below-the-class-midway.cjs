// A helper copied in line tells three classes apart in a loop. Midway a parsed object is laid below the prototype of the first class: it never has the shape of the class and is an instance of it from then on.
// STATISTIC: InstanceOfMissesWalkedInline >= 1
"use strict";
class Circle { constructor(d) { this.r = d.r; } }
class Rect { constructor(d) { this.w = d.w; this.h = d.h; } }
class Tri { constructor(d) { this.w = d.w; this.h = d.h; this.k = 1; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ r: i % 5 + 1, w: i % 4 + 1, h: i % 6 + 2 }))));
const makers = new Map([[0, Circle], [1, Rect], [2, Tri]]);
const all = rows.map((d, i) => new (makers.get(i % 3))(d));
let hits = 0, thrown = 0;
const late = JSON.parse("{\"r\":5}"); all[4] = late;
function g(s) { return s instanceof Circle ? (s.r ?? 100) : s instanceof Rect ? (s.w ?? 200) : s instanceof Tri ? (s.h ?? 300) : 7; }
function f(t) { let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) { if (t === (n >> 1)) Object.setPrototypeOf(late, Circle.prototype); sum = (sum + f(t)) % 1000003; } console.log(sum, hits, thrown);
