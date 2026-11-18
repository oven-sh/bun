// A helper copied in line tells three classes apart in a loop. The guards of all three questions are asked once in front of the typed copy of the loop, also those of the second and the third, which stand under a branch of the helper:
// so none of them is asked in a turn.
// STATISTIC: InstanceOfMissesWalkedInline >= 1
// STATISTIC: InstanceOfGuardsHoisted >= 3
"use strict";
class Circle { constructor(d) { this.r = d.r; } }
class Rect { constructor(d) { this.w = d.w; this.h = d.h; } }
class Tri { constructor(d) { this.w = d.w; this.h = d.h; this.k = 1; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ r: i % 5 + 1, w: i % 4 + 1, h: i % 6 + 2 }))));
const makers = new Map([[0, Circle], [1, Rect], [2, Tri]]);
const all = rows.map((d, i) => new (makers.get(i % 3))(d));
const far = v => [v][JSON.parse("0")];
let hits = 0, calls = 0;
function g(s) { return s instanceof Circle ? (s.r ?? 100) : s instanceof Rect ? (s.w ?? 200) : s instanceof Tri ? (s.h ?? 300) : 7; }
function f(t) { let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum, hits, calls);
