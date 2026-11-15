// What a loop calls takes copies of what it calls in turn: objects that fall away in them, and those that do not.
let deeds = 0; const kept = [];
class Vector {
  constructor(x, y) { this.x = x; this.y = y; }
  minus(other) { return new Vector(this.x - other.x, this.y - other.y); }
  plus(other) { deeds++; return new Vector(this.x + other.x, this.y + other.y); }
  dot(other) { return this.x * other.x + this.y * other.y; }
  scaled(k) { return k === 1 ? this : new Vector(this.x * k, this.y * k); }
  keep() { kept.push(this); return this; }
  static between(a, b) { return a.plus(b).scaled(0.5); }
}
class Shape { constructor(center) { this.center = center; } area() { throw new TypeError("no area"); } }
class Sphere extends Shape { constructor(center, radius) { super(center); this.radius = radius; } near(point) { const d = point.minus(this.center); return d.dot(d) < this.radius * this.radius; } area() { return 3 * this.radius * this.radius; } }
class Box extends Shape { constructor(center, size) { super(center); this.size = size; } near(point) { const d = Vector.between(point, this.center).minus(this.center); return Math.abs(d.x) < this.size && Math.abs(d.y) < this.size; } area() { return this.size * this.size; } }
class Odd extends Shape { near(point) { const d = point.minus(this.center); if (d.x > 2) d.keep(); if (d.y > 2) throw new RangeError("far " + d.y); return d.scaled(1) === d; } }
const shapes = [new Sphere(new Vector(0, 0.5), 1), new Box(new Vector(3, 4), 2), new Odd(new Vector(1, 1)), new Sphere(new Vector("1", 2), 3)];
function count(list, point) { let n = 0; for (const shape of list) { try { if (shape.near(point)) n += 1; } catch (error) { n += error.message.length; } } return n; }
function areas(list) { const all = []; for (let i = 0; i < list.length; i++) { try { all.push(list[i].area()); } catch (error) { all.push(error.message); } } return all; }
const lines = [];
for (const x of [0, -0, 0.5, 3, 5, NaN, 2 ** 31, 2 ** 53, "2", null, undefined, 7n]) for (const y of [0, 1, 4]) { try { lines.push(count(shapes, new Vector(x, y))); } catch (error) { lines.push(error.constructor.name); } }
lines.push(areas(shapes).join(), deeds, kept.length, kept.every(v => v instanceof Vector));
function fold(list, f) { let value = list[0]; for (let i = 1; i < list.length; i++) value = f(value, list[i]); return value; }
const pair = (a, b) => ({ a, b }), first = p => p.a, swap = p => pair(p.b, p.a), sum = (a, b) => first(swap(pair(a, b))) + first(pair(a, b));
lines.push(fold([1, 2.5, 3, "x", null, undefined, true], sum), fold([1n, 2n, 3n], sum), fold([2 ** 31, 1, -1], sum));
Vector.prototype.dot = function (other) { return this.x; };
lines.push(count(shapes, new Vector(0.5, 0.5))); Vector.prototype.minus = function (other) { return { x: 1, y: 9, dot: () => -1, scaled: () => 0, keep() { } }; };
lines.push(count(shapes, new Vector(0.5, 0.5)));
console.log(lines.join("\n"));
