// A generator gives a variable a new object in a catch. Behind the catch, a call and a stop, the old object, which a constant still holds, is the argument of a method of the new one.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(other: Point): number {
    return this.x * 100 + other.x;
  }
}
const given: number[] = JSON.parse("[0.5, 1, 2]");
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  return o.constructor.name;
}
function fail(when: boolean): void {
  if (when) throw new Error("no");
}
function* run(p: number): Generator<unknown, string, unknown> {
  let out = "";
  let o1 = new Point(p + 1, given[2]);
  const o2 = o1;
  try {
    yield p;
    fail(given[0] > p);
    o1.y;
  } catch {
    o1 = Object.assign(new Point(0, 0), o1, { x: o1.x + 1 });
  }
  o2.y += 1;
  out += show(o1);
  yield p;
  out += " " + o1.sum(o2) + "," + o2.sum(o1);
  return out;
}
const lines: string[] = [];
for (let round = 0; round < 12; round++) {
  const steps = run(round);
  let result = steps.next();
  for (let i = 0; i < 20 && !result.done; i++) result = steps.next();
  lines.push(String(result.value));
}
console.log(lines.join(" | "));
