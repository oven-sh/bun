// Where a function only reads the fields of what a field of its parameter holds, and nothing writes those while it runs, it takes them, too.
// STATISTIC: ScalarizedHeldObjects >= 4
class Vector {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  dot(other: Vector) {
    return this.x * other.x + this.y * other.y;
  }
  half() {
    return new Vector(this.x / 2, this.y / 2);
  }
  flip() {
    this.y = -this.y;
  }
  static add(a: Vector, b: Vector) {
    return new Vector(a.x + b.x, a.y + b.y);
  }
}
class Ray {
  from: Vector;
  to: Vector;
  length: number;
  constructor(from: Vector, to: Vector, length: number) {
    this.from = from;
    this.to = to;
    this.length = length;
  }
}
const xs = [3, 1.5, -0, 9, 2 ** 31, 7];
const shared = new Vector(4, 5);

function reads(ray: Ray, k: number): number {
  let total = 0;
  for (const x of xs) if (x < ray.to.x) total += shared.dot(ray.to) + ray.from.x + x;
  return total + Vector.add(ray.from, shared).y + ray.length * k;
}
function passesOn(ray: Ray, k: number): number {
  let total = reads(ray, k);
  for (const x of xs) if (x === k) total += x;
  return total - reads(ray, k + 1) + ray.to.x / 2;
}

class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Pair {
  a: Point;
  b: Point;
  constructor(a: Point, b: Point) {
    this.a = a;
    this.b = b;
  }
}
const point = new Point(1, 2);
function writesMeanwhile(pair: Pair, k: number): string {
  let text = "" + pair.a.x;
  for (const x of xs) if (x === k) point.x += 10;
  return text + " " + pair.a.x + " " + (pair.b === point);
}
function callsWriter(pair: Pair, k: number): number {
  let total = pair.a.y;
  for (const x of xs) if (x === k) moves(k);
  return total * 100 + pair.a.y;
}
function moves(k: number) {
  point.y = k;
}

function rows(k: number) {
  const made = new Vector(k, 0.5);
  made.flip();
  const a = reads(new Ray(made, new Vector(k * 2, -0), 0.25), k);
  const b = passesOn(new Ray(shared, made.half(), k), 3);
  const ray = new Ray(made, shared, 1);
  const c = reads(ray, 2);
  made.x = 100;
  const d = reads(ray, 2);
  const e = writesMeanwhile(new Pair(point, new Point(k, k)), k);
  const f = callsWriter(new Pair(point, point), k);
  return [a, b, c, d, e, f, made.x, made.y, ray.from === made, ray.to.x].join(" ");
}
for (let k = 0; k < 11; k++) console.log(rows(k));
