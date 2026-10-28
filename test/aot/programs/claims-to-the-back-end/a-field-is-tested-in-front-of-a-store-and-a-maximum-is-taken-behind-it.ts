type Flat = { x: number; y: number };
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  let all = o.constructor === Object ? "{" : o.constructor.name + "{";
  for (const key of Object.keys(o)) all += key + ":" + show((o as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
  moved(by: number): Point {
    return new Point(this.x + by, this.y + by);
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
  sum(): number {
    return super.sum() + this.z;
  }
}
const given: number[] = JSON.parse("[0, 1, 2, 3, 0.5]");
function fail(when: boolean): void {
}
function turned(o: Flat): Flat {
  return { x: o.y, y: o.x };
}
function both(x: number): [Flat, Flat] {
}
function made1(p: number, q: number): Flat {
}
function run1(p: number, q: number): string {
  function* steps(): Generator<string, void, unknown> {
  try {
  {
  }
  } catch {
  }
  }
}
function* run2(p: number, q: number): Generator<number, string, unknown> {
  switch (a & 3) {
  }
}
class Holder5 {
  inner: Flat = new Point(1, 2);
  list: number[] = [];
  constructor(x: number) {
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
function run3(p: number, q: number): string {
  let out = "";
  function* steps(): Generator<string, void, unknown> {
  let a: number = p;
  let b: number = 0.5;
  let turns = 0;
  let o1: Flat = [{ x: a | 0, y: a + b }][0];
  let o2: Flat = turned(o1);
  const box = new Holder5(a);
  let o3: Flat = Object.assign({ x: 0, y: 0 }, { x: given[4] });
  const local: Flat[] = [];
  for (let i = 0; i < 2 && turns++ < 8; i++) {
  {
  }
  out += (o1 instanceof Point) + "," + (o1 instanceof Point3) + " ";
  }
  out += show(o1) + show(o2) + show(o3) + " " + show(box) + num(box.total()) + local.length + (o1 === o2) + (o2 === o3);
  }
  return [...steps()].join("") + out;
}
class Holder6 {
  constructor(x: number) {
  }
  total(): number {
  }
}
function* run4(p: number, q: number): Generator<number, string, unknown> {
  let out = "";
  let a: number = p;
  let b: number = p * 2;
  const o1: Flat = new Point(a / 2, q).moved(given[4]);
  const o2: Flat = o1;
  const o3: Flat = (() => o1)();
  const many: number[] = [a, b, 1];
  const soft = many as any;
  try {
  yield a;
  } finally {
  out += num(Math.max(o1.x, o2.x)) + "," + num(o1.x * o2.y) + " ";
  }
  o3.x = soft[a & 1];
  out += num(Math.max(o1.x, o2.x)) + "," + num(o1.x * o2.y) + " ";
  return out;
}
class Holder7 {
  constructor(x: number) {
  }
}
function run7(p: number, q: number): string {
  try {
  {
  }
  } catch {
  }
  }
for (let round = 0; round < 2; round++) console.log("3: " + run3(3, 60));
{
  const steps = run4(1, 2);
  let result = steps.next();
  for (let i = 0; i < 60 && !result.done; i++) result = steps.next();
  }
