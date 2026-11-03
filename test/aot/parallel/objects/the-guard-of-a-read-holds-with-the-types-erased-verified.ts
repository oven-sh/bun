// Flags: --aot-check=verify-each-stage --aot-erase-types
type Flat = { x: number; y: number };
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  if (Array.isArray(o)) return "[" + o.map(show).join() + "]";
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
  constructor(x: number, y: number, z: number) {
    super(x, y);
  }
}
const kept: unknown[] = [];
function fail(when: boolean): void {
}
function sumOf(o: Flat): number {
}
function make(x: number, y: number): Flat {
}
function nest(x: number): Nest {
}
function made1(p: number, q: number): Flat {
  let a: number = p;
  let b: number = 1;
  let o1: Flat = new Point(0.5, a * 2);
  let o2: Flat = { x: 0.5, y: a - b };
  return { x: o1.x, y: o2.y };
}
class Holder2 {
  inner = { x: 1, y: 2 };
  tag = "t";
  list: number[] = [1];
  constructor(x: number) {
  }
  total(): number {
    return this.inner.x + this.inner.y + this.list.length;
  }
}
async function run1(p: number, q: number): Promise<string> {
  let out = "";
  let a: number = q;
  let turns = 0;
  let o1: Flat = { x: a, y: a };
  let o2: Flat = made1(q, 0.5);
  const box = new Holder2(p);
  let o3: Flat = o1;
  const local: Flat[] = [];
  for (let i = 0; i < 4 && turns++ < 8; i++) {
  if (o1.x === 0.5) kept.push(box.list);
  [o1, o2] = [o2, o1];
  }
  try {
  } catch {
  o3 = { ...o3, x: -0 };
  }
  out += show(o1) + show(o2) + show(o3) + " " + num(box.inner.x) + "," + num(box.inner.y) + box.tag + box.list.join("/") + num(box.total()) + local.length + (o1 === o2) + (o2 === o3);
  return out;
}
function run2(p: number, q: number): string {
  function* steps(): Generator<string, void, unknown> {
  switch (a & 3) {
  }
  try {
  } catch {
  {
  }
  }
  if (o2.x > o1.x) {
  }
  try {
  } catch {
  }
  }
}
class Holder4 {
}
function* run3(p: number, q: number): Generator<number, string, unknown> {
  try {
  } finally {
  }
}
class Holder5 {
  constructor(x: number) {
  }
}
function run4(p: number, q: number): string {
  function* steps(): Generator<string, void, unknown> {
  try {
  } finally {
  {
  }
  }
  }
}
function run5(p: number, q: number): string {
  (() => {
  {
  }
  })();
}
for (let round = 0; round < 2; round++) console.log("1: " + (await run1(0.5, 2)));
