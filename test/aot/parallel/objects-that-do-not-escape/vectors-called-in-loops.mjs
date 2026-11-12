// A function that a loop calls takes the vectors of its callees apart: none is allocated where nobody sees it, and whoever sees one sees it whole.
const seen = [];
const marks = new WeakMap();
class Vector {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  minus(o) {
    return new Vector(this.x - o.x, this.y - o.y, this.z - o.z);
  }
  times(k) {
    return new Vector(this.x * k, this.y * k, this.z * k);
  }
  dot(o) {
    return this.x * o.x + this.y * o.y + this.z * o.z;
  }
  length() {
    return Math.sqrt(this.dot(this));
  }
  unit() {
    const m = this.length();
    return new Vector(this.x / m, this.y / m, this.z / m);
  }
  maybe() {
    return this.x > 1 ? new Vector(this.z, this.y, this.x) : null;
  }
}
function distance(a, b) {
  const way = a.minus(b);
  return way.length() + way.dot(way);
}
function direction(a, b) {
  return a.minus(b).unit();
}
function shows(a, b, i) {
  const way = a.minus(b).times(2);
  if (i === 2) seen.push(way);
  if (i === 3) marks.set(way, i);
  way.x += 1;
  return way.x + (marks.get(way) ?? 0);
}
function throws(a, b, i) {
  const way = a.minus(b);
  try {
    if (i === 1) throw way;
    return way.z;
  } catch (caught) {
    return caught === way ? caught.y : "another";
  }
}
function changes(a, b, i) {
  const way = a.minus(b);
  if (i === 4) Object.defineProperty(way, "x", { get: () => 11 });
  if (i === 5) Object.setPrototypeOf(way, { dot: () => 5 });
  return way.dot(way) + way.x;
}
function perhaps(a, b) {
  const found = a.minus(b).maybe();
  return found === null ? "none" : found.x + found.y;
}
const here = new Vector(1.5, 2.5, -1);
const points = [];
for (let i = 0; i < 6; i++) points.push(new Vector(i, i * 0.5, 3 - i));
for (let i = 0; i < points.length; i++) {
  const to = direction(points[i], here);
  console.log(distance(points[i], here).toFixed(6), to.x.toFixed(6), shows(points[i], here, i), throws(points[i], here, i), changes(points[i], here, i), perhaps(points[i], here));
}
console.log(seen.length, seen[0].x, seen[0].y, seen[0] instanceof Vector, Object.keys(seen[0]).join());
Vector.prototype.dot = () => 1;
console.log(distance(points[4], here), changes(points[0], here, 0));
