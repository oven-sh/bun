// A helper copied in line tells three classes apart in a loop, and the guards of its questions are asked in front of the typed copy. One element is an instance of the first class by its chain alone, and its getter, once,
// gives the second class a Symbol.hasInstance of its own in the middle of the loop. The read of that getter leaves the typed copy before it runs, so the rest of the loop asks as it is written and that method answers.
// STATISTIC: InstanceOfMissesWalkedInline >= 1
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
let armed = false; const sly = { get r() { if (armed) { armed = false; calls++; far(Object).defineProperty(far(makers).get(1), far(Symbol).hasInstance, { configurable: true, value(o) { hits++; return false; } }); } return 3; } }; far(Object).setPrototypeOf(sly, far(makers).get(0).prototype); all[6] = far(sly);
function f(t) { if (t === 40) armed = true; let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum, hits, calls);
