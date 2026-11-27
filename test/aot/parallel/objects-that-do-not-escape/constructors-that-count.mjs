// A constructor that counts what it makes is copied where the object is only taken apart.
let made = 0, last = null;
const kept = [];
class Vector {
  static made = 0;
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; made++; Vector.made += 2; if (x === 99) throw new RangeError("x"); if (y === 77) return; if (z === 55) return other; }
  sub(o) { return new Vector(this.x - o.x, this.y - o.y, this.z - o.z); }
  add(o) { return new Vector(this.x + o.x, this.y + o.y, this.z + o.z); }
  dot(o) { return this.x * o.x + this.y * o.y + this.z * o.z; }
  scale(k) { return new Vector(this.x * k, this.y * k, this.z * k); }
}
const other = { x: 1000, y: 1, z: 1, dot() { return -1; }, scale() { return this; }, sub() { return this; } };
class Numbered extends Vector { constructor(x, y) { super(x, y, 1); this.id = made; } }
class Sphere {
  constructor(center, radius) { this.center = center; this.radius = radius; }
  distance(p) { const d = p.sub(this.center), b = d.dot(p); return b - d.dot(d) + this.radius; }
}
class Plane {
  constructor(up, height) { this.up = up; this.height = height; }
  distance(p) { const q = p.add(this.up); if (q.x > 40) { kept.push(q); return q.y; } return this.up.dot(q.scale(0.5)) - this.height; }
}
class Guarded extends Sphere { distance(p) { try { return p.sub(this.center).scale(2).z; } catch (e) { return e.message.length + made; } } }
const run = (all, n) => { let sum = 0; for (let k = 0; k < n; k++) for (const s of all) { last = new Vector(k & 7, 1.5, 2); sum += s.distance(last); } return sum; };
const all = () => [new Sphere(new Vector(1, 2, 3), 1), new Plane(new Vector(0, 1, 0.5), -1), new Guarded(new Numbered(2, 3), 0)];
for (let round = 0; round < 3; round++) {
  made = Vector.made = 0;
  console.log(run(all(), 40), made, Vector.made, last.x);
  console.log(run([new Sphere(new Vector(-92, 0, 0), 1)].concat(new Guarded(new Vector(-93, 0, 0), 2)).slice(1), 9), made);
  console.log(run([new Plane(new Vector(50, 76, 0), 1), new Sphere(new Vector(0, -75.5, 0), 2), new Sphere(new Vector(0, 0, -53), 2)], 9), made, kept.length, kept[0].y);
  try { run([new Sphere(new Vector(-92, 0, 0), 1)], 9); } catch (e) { console.log(e.name, made); }
  kept.length = 0;
}
