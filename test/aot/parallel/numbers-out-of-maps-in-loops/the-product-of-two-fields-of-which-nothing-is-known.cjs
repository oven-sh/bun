// A helper copied in line into a loop tells three classes apart and multiplies two fields that came out of JSON.parse, so nothing is known of either.
// Both are asked for numbers in the turn, which begins again where one is none. So no operator that may run other code stands on the usual way, and the questions by instanceof keep their typed form.
// STATISTIC: OperandsAskedForNumberInQuietTurns >= 1
// STATISTIC: MissesOfInstanceOfThatStayInTheTurn >= 1
"use strict";
const rows = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => '{"x":' + i + ',"y":' + (i * 7 % 5) + "}").join() + "]");
class Shape { }
class Circle extends Shape { constructor(r) { super(); this.r = r; } }
class Rect extends Shape { constructor(w, h) { super(); this.w = w; this.h = h; } }
class Line extends Shape { constructor(b) { super(); this.b = b; } }
const shapes = rows.map((row, i) => i % 3 === 0 ? new Circle(row.x) : i % 3 === 1 ? new Rect(row.x, row.y) : new Line(row.y));
function area(o) { if (o instanceof Circle) return o.r * 3; if (o instanceof Rect) return o.w * o.h; if (o instanceof Line) return o.b; return 0; }
function all(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += area(shapes[i]); return s; }
const n = 120; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + all(t)) % 1000003; console.log(sum);
