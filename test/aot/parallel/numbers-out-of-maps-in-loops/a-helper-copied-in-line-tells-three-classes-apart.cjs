// A helper that is copied in line tells three classes apart, and the list holds all three by turns. Where the shape of an element does not say yes, the chain of its prototypes is walked in the turn,
// so no way through the helper leaves the typed copy of the loop at an operation as it is written: what the helper hands back is asked for a number, and the sum stays typed.
// STATISTIC: AnswersOfLookupsAskedForNumbers >= 1
// STATISTIC: MissesOfInstanceOfThatStayInTheTurn >= 1
"use strict";
class Circle { constructor(d) { this.r = d.r; } }
class Rect { constructor(d) { this.w = d.w; this.h = d.h; } }
class Tri { constructor(d) { this.w = d.w; this.h = d.h; this.k = 1; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ r: i % 5 + 1, w: i % 4 + 1, h: i % 6 + 2 }))));
const classes = new Map([[0, Circle], [1, Rect], [2, Tri]]);
const all = rows.map((d, i) => new (classes.get(i % 3))(d));
function measure(s) { return s instanceof Circle ? s.r : s instanceof Rect ? s.w : s instanceof Tri ? s.h : 0; }
function f(t) { let s = t & 1; for (const x of all) s += measure(x); return s; }
let sum = 0; for (let t = 0; t < 300; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
