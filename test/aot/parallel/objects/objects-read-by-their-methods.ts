// A method or a getter that only reads the fields of its receiver keeps it as little as a function that takes it.
// STATISTIC: ScalarizedArguments >= 5
// STATISTIC: ScalarizedHeldObjects >= 2
class Vector {
  #x = 0;
  #y = 0;
  constructor(x: number, y: number) {
    this.#x = x;
    this.#y = y;
  }
  get x() {
    return this.#x;
  }
  get y() {
    return this.#y;
  }
  dot(other: Vector) {
    return this.#x * other.#x + this.#y * other.#y;
  }
  half() {
    return new Vector(this.#x / 2, this.#y / 2);
  }
  turn() {
    this.#y = -this.#y;
    return this;
  }
}
class Ray {
  #from: Vector;
  #to: Vector;
  length = 1;
  constructor(from: Vector, to: Vector, length: number) {
    this.#from = from;
    this.#to = to;
    this.length = length;
  }
  get from() {
    return this.#from;
  }
  get to() {
    return this.#to;
  }
  size() {
    return this.#to.dot(this.#from) * this.length;
  }
  static is(value: unknown) {
    return typeof value === "object" && value !== null && #to in value;
  }
}
const xs = [3, 1.5, -0, 9, 2 ** 31, 7];
const shared = new Vector(4, 5);

function reads(ray: Ray, k: number): number {
  let total = ray.size();
  for (const x of xs) if (x < ray.to.x) total += ray.to.dot(ray.from) + x;
  return total + ray.from.half().y + ray.length * k;
}
function passesOn(ray: Ray, k: number): number {
  let total = reads(ray, k);
  for (const x of xs) if (x === k) total += x;
  return total - ray.to.x;
}

class Counter {
  count: number;
  step: number;
  constructor(count: number, step: number) {
    this.count = count;
    this.step = step;
  }
  next() {
    this.count += this.step;
    return this;
  }
  get far() {
    return this.count > 10 ? this.count : -this.step;
  }
  keep() {
    kept.push(this);
    return this.count;
  }
}
const kept: Counter[] = [];
function writesReceiver(counter: Counter, k: number): number {
  let total = 0;
  for (const x of xs) if (x > k) total += counter.next().count;
  return total + counter.far;
}
function keepsReceiver(counter: Counter, k: number): number {
  let total = counter.far;
  for (const x of xs) if (x === k) total += counter.keep();
  return total;
}
function onlyFar(counter: Counter, k: number): number {
  let total = 0;
  for (const x of xs) if (x > k) total += counter.far;
  return total;
}

class Late {
  a: number;
  b: number;
  constructor(a: number, b: number) {
    this.a = a;
    this.b = b;
  }
  sum() {
    return this.a + this.b;
  }
}
function late(value: Late, k: number): number {
  let total = 0;
  for (const x of xs) if (x < 100) total += value.sum();
  if (k === 6) Late.prototype.sum = function (this: Late) { return this.a * 1000; };
  return total + value.sum();
}

const tested = new Ray(shared, shared, 2);
function rows(k: number) {
  const made = new Vector(k, 0.5);
  made.turn();
  const a = reads(new Ray(made, new Vector(k * 2, -0), 0.25), k);
  const b = passesOn(new Ray(shared, made.half(), k), 3);
  const ray = new Ray(made, shared, 1);
  const c = reads(ray, 2);
  const counter = new Counter(k, 1.5);
  const d = writesReceiver(counter, k);
  const e = keepsReceiver(new Counter(k, 2), k);
  const f = onlyFar(new Counter(k * 2, 3), k);
  const g = late(new Late(k, 1), k);
  return [a, b, c, d, counter.count, e, f, g, Ray.is(tested), Ray.is(shared), ray.to === shared, kept.length].join(" ");
}
for (let k = 0; k < 11; k++) console.log(rows(k));
for (const counter of kept) console.log(counter.next().count, counter instanceof Counter);
