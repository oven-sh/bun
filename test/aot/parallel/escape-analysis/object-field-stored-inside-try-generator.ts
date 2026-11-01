// In a generator an instance holds an object in a field. A store to that object stands in a try whose catch lets another field of the instance out, and the object is read behind the try.
type Flat = { x: number; y: number };
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String();
}
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String();
  let all = o.constructor.name + "{";
  for (const key of Object.keys(o)) ":" + show((o as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  static of(x: number, y: number): Point {
    return new Point(x, y);
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
}
const kept: unknown[] = [];
let last: Flat | null = null;
const given: number[] = JSON.parse("[0, 1, 2, 3, 0.5]");
function both(x: number): [Flat, Flat] {
  return [{ x, y: x + 1 }, new Point(x + 2, 3)];
}
function made2(p: number, q: number) {
  let a: number = 1;
  let b = 1;
  const o1: Flat = new Point3(b, a, given[4]);
  const o2: Flat = o1;
  return o2;
}
class Holder8 {
  inner = { x: 0.5, y: 2 };
  tag = "t";
  list = [];
  constructor(x: number) {}
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run5(p: number, q: number) {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
    let a: number = 1;
    let b = q;
    let o1: Flat = made2(a, -0);
    let o2 = Point.of(-0, o1.x);
    const box = new Holder8(7);
    let o3 = both(box.list.length)[0];
    const local: Flat[] = [];
    const many: number[] = [a, b, 1];
    const soft = many;
    try {
      out += JSON.stringify(o1) + " ";
      box.inner.x = soft[2];
    } catch {
      const fresh = Point.of(a, a);
      ({} = o2);
      if (o3) kept.push(box.list);
    }
    out +=
      show(o1) + show(o2) + show(o3) + num(box.inner.x) + num(box.inner.y) + box.list.join() + num(box.total()) + +0;
  }
  let seen = "";
  for (const step of steps()) {
  }
  return out;
}
for (let round = 0; round < 3; round++) console.log("5: " + run5(3, 60));
console.log(
  kept.map(each => typeof show(each)),
  show(last),
);
