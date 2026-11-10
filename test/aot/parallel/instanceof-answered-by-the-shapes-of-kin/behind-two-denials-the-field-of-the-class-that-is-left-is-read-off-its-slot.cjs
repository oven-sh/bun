// A helper copied in line asks whether its operand is an instance of one class, then of another, and behind both denials reads a field. The three classes are kin: what both questions have left is known by shape,
// so the read asks no site by name.
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin >= 2
// STATISTIC: ReadsByNameThatAskTheirSitesAlone = 0
"use strict";
class Circle { constructor(d) { this.r = d.v; } }
class Rect { constructor(d) { this.w = d.w; this.h = d.v; } }
class Tri { constructor(d) { this.w = d.w; this.h = d.v; this.k = 1; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ v: i % 5 + 1, w: i % 4 + 1 }))));
const classes = new Map([[0, Circle], [1, Rect], [2, Tri]]);
const all = rows.map((d, i) => new (classes.get(i % 3))(d));
function g(s) { if (s instanceof Circle) return s.r; if (s instanceof Rect) return s.w; return s.h; }
function f(t) { let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
