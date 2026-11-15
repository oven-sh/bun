// A function that only reads an object that every caller allocates for the call takes the fields, and a caller allocates the object where it needs one.
// STATISTIC: ScalarizedArguments >= 5
class Ray {
  x: number;
  y: number;
  name: string | null;
  list: number[] | undefined;
  constructor(x: number, y: number, name: string | null, list?: number[]) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.list = list;
  }
  length() {
    return Math.hypot(this.x, this.y);
  }
}
const xs = [3, 1.5, -0, 9, 2 ** 31, 7];

function near(ray: Ray, k: number): number {
  let count = 0;
  for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i]! - ray.x) < Math.abs(ray.y) + k) count += i + 1;
  if (ray.name) count += ray.name.length * 100;
  return ray.list ? count + ray.list.length : count;
}
function passesOn(ray: Ray, k: number): number {
  let total = 0;
  for (let i = 0; i < k; i++) total += near(ray, i);
  return total + (Object.is(ray.x, -0) ? 0.5 : 0);
}
function both(ray: Ray, at: { min: number; max: number }): number {
  let total = 0;
  for (const x of xs) if (x >= at.min && x <= at.max) total += ray.x - x;
  return ray.name === null ? total : -total;
}
function down(at: { min: number; max: number }, k: number): number {
  if (k <= 0) return at.max - at.min;
  for (const x of xs) if (x === k) return at.min + x;
  return down({ min: at.min + 1, max: at.max }, k - 1);
}
function throws(ray: Ray, k: number): number {
  for (let i = 0; i < k; i++) if (i === 5) throw ray.name;
  return ray.y;
}
function make(k: number): Ray {
  const ray = new Ray(k, -k, null);
  for (const x of xs) if (x > k) ray.x += x;
  return ray;
}
const kept: Ray[] = [];
function keeps(ray: Ray, k: number): number {
  for (const x of xs) if (x === k) kept.push(ray);
  return kept.length + ray.x;
}
function rows(k: number) {
  const a = near(new Ray(k, 0.5, k % 2 ? "n" + k : null, k % 3 ? xs : undefined), k);
  const changed = new Ray(-0, k, null);
  const b = passesOn(changed, k);
  changed.x = k * 0.5;
  changed.name = "changed";
  const c = passesOn(changed, 2);
  const d = both(new Ray(2 ** 31, NaN, k % 2 ? null : ""), { min: k - 4, max: k + 2 ** 31 });
  const e = down({ min: k, max: k * 2 }, k % 5);
  let f: unknown;
  try {
    f = throws(new Ray(0, k, "thrown " + k), k);
  } catch (error) {
    f = error;
  }
  const g = near(make(k), 1);
  const h = keeps(new Ray(k, 1, "kept"), k);
  const seen = new Ray(1, k, "seen");
  const i = near(seen, k);
  return [a, b, c, d, e, f, g, h, i, seen.length() > 4, JSON.stringify(seen), seen instanceof Ray].join(" ");
}
for (let k = 0; k < 11; k++) console.log(rows(k));
console.log(kept.length, kept.map(ray => ray.x + ray.name!).join());

function last(ray: Ray, k: number): number {
  let total = k;
  for (const x of xs) total += x * ray.y;
  return total;
}
const byValue: ((ray: Ray, k: number) => number)[] = [last];
for (const f of byValue) console.log(f(new Ray(1, 2, null), 3), last(new Ray(1, 0.5, null), 4));
let round = new Ray(1, 1, null);
for (let i = 0; i < 6; i++) round = near(round, i) > 8 ? new Ray(i, round.y + 1, "r") : new Ray(round.x + 1, i, null);
console.log(JSON.stringify(round));
