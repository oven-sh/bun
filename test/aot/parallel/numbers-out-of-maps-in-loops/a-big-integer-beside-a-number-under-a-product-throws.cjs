// Nothing is known of either operand of a product in a helper copied into a loop, and both are asked for numbers. A big integer beside a number throws as it does in plain Bun.
// STATISTIC: OperandsAskedForNumberInQuietTurns >= 1
"use strict";
const log = [];
const rows = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => '{"x":' + (i + 1) + ',"y":' + (i * 7 % 5 + 1) + "}").join() + "]");
class Shape { }
class Circle extends Shape { constructor(r) { super(); this.r = r; } }
class Rect extends Shape { constructor(w, h) { super(); this.w = w; this.h = h; } }
class Line extends Shape { constructor(b) { super(); this.b = b; } }
const shapes = rows.map((row, i) => i % 3 === 0 ? new Circle(row.x) : i % 3 === 1 ? new Rect(row.x, row.y) : new Line(row.y));
shapes[31] = new Rect(3n, 4);
function area(o) { if (o instanceof Circle) return o.r * 3; if (o instanceof Rect) return o.w * o.h; if (o instanceof Line) return o.b; return 0; }
function all(t) { let s = t & 1; for (let i = 0; i < 64; i++) s += area(shapes[i]); return s; }
let sum = 0; for (let t = 0; t < 60; t++) { try { sum = (sum + all(t)) % 1000003; } catch (e) { sum += e.constructor.name.length; } } console.log(sum, log.length, log.slice(0, 6).join());
