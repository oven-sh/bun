// A helper copied in line asks whether its operand is an instance of a class, and behind the denial reads a field that the class has too. What an instanceof has denied is not expected behind it:
// the read does not test for the class just denied, which every element that comes there would fail, but asks its own site.
// The class has no kin, and parsed records come behind the denial: of kin, classes or constructor functions, the shapes say what a denial has left, and the read is a slot:
// ../instanceof-answered-by-the-shapes-of-kin/behind-two-denials-the-field-of-the-class-that-is-left-is-read-off-its-slot.cjs
// STATISTIC: MissesOfInstanceOfThatStayInTheTurn >= 1
// STATISTIC: ReadsByNameThatAskTheirSitesAlone >= 1
// STATISTIC: MissesOfInstanceOfAnsweredByShapesOfKin = 0
"use strict";
class Circle { constructor(d) { this.r = d.v; this.h = 0; } }
const rows = JSON.parse(JSON.stringify(Array.from({ length: 24 }, (_, i) => ({ v: i % 5 + 1, w: i % 4 + 1, h: i % 3 + 2 }))));
const all = rows.map((d, i) => (i % 3 ? d : new Circle(d)));
function g(s) { if (s instanceof Circle) return s.r; return s.h; }
function f(t) { let s = t & 1; for (const x of all) s += g(x); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
