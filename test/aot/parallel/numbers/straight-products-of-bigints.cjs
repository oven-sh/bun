// Straight products in functions that loops call: of BigInts beside a BigInt modulus, of numbers, of both, of objects, and of values that throw in the middle.
"use strict";
const P = 2n ** 127n - 1n, zero = 0n, two = 2n;
const log = [];
function mod(a, b = P) {
  const r = a % b;
  return r >= zero ? r : b + r;
}
class Point {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  double() {
    const { x, y, z } = this;
    const a = mod(x * x);
    const b = mod(y * y);
    const c = mod(two * mod(z * z));
    const d = mod(a * b);
    const e = mod((x + y) * (x + y) - a - b);
    return new Point(mod(d + c), mod(e * c - a), mod(b * c + two));
  }
  add(other) {
    const { x: x1, y: y1, z: z1 } = this;
    const { x: x2, y: y2, z: z2 } = other;
    const a = mod((y1 - x1) * (y2 + x2));
    const b = mod((y1 + x1) * (y2 - x2));
    log.push(typeof a);
    const c = mod(z1 * two * z2);
    return new Point(mod(a * b), mod(b * c), mod(c + a * z1));
  }
}
function norm(p, q) {
  const s = p.x * q.x + p.y * q.y + p.z * q.z;
  const t = p.x * p.x - q.y * q.y + p.z * q.x;
  return s * t - s;
}
function noted(p, k) {
  const a = p.x * k + p.y * k;
  log.push(String(a));
  const b = p.y * k - p.z * k;
  p.x = a;
  p.y = b;
  return a * b + p.x * p.y;
}
const object = (value) => ({ valueOf() { log.push("v"); return value; } });
const kept = [new Point(3n, 5n, 7n), new Point(11n, -13n, 17n)];
globalThis.kept = kept;
globalThis.Point = Point;
let p = kept[0];
for (let i = 0; i < 40; i++) p = i % 3 ? p.double() : p.add(kept[1]);
console.log(p.x, p.y, p.z);
const others = [
  new Point(1, 2, 3), new Point(0.5, -0, NaN), new Point(1n, 2, 3n), new Point(1, 2n, 3n), new Point(1n, 2n, 3), new Point("4", "5", "6"), new Point(undefined, null, true),
  new Point(object(2n), object(3n), object(4n)), new Point(object(2), object(3), object(4)), { x: 2n, y: 3n, z: 4n }, { z: 2n, x: 3n, y: 4n }, { get x() { log.push("x"); return 6n; }, y: 7n, z: 8n }, Object.create({ x: 9n, y: 10n, z: 11n }),
];
const said = (f) => {
  try {
    const r = f();
    return typeof r === "object" ? [r.x, r.y, r.z].join() : `${typeof r} ${String(r)}`;
  } catch (error) {
    return `${error.name}: ${error.message.slice(0, 24)}`;
  }
};
for (let turn = 0; turn < 3; turn++) {
  for (const q of others) {
    console.log(said(() => Point.prototype.double.call(q)), "|", said(() => p.add(q)), "|", said(() => Point.prototype.add.call(q, p)), "|", said(() => norm(p, q)), "|", said(() => norm(q, q)), "|", log.splice(0).join());
  }
}
for (const k of [2n, 3, 1.5, object(2n), "7", Symbol.iterator]) for (const q of [new Point(1n, 2n, 3n), new Point(1, 2, 3), new Point(1, 2n, 3)]) console.log(said(() => noted(q, k)), said(() => q), log.splice(0).join());
