// A generator gives a variable a new object in a catch. Behind the catch and a stop, the new object and the old one, which a constant still holds, go into a third: it holds two objects.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Other {
  x: number;
  y: number;
  tag = "other";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
type Flat = Point | Other;
class Pair {
  constructor(
    public a: Flat,
    public b: Flat,
  ) {}
}
const given: number[] = JSON.parse("[0.5]");
function fail(when: boolean): void {
  if (when) throw new Error("no");
}
function revived(o: Flat): Flat {
  return JSON.parse("[0]", (key, value) => (key === "0" ? o : value))[0];
}
function* run(p: number): Generator<unknown, string, unknown> {
  let out = "";
  let o1: Flat = revived(new Point(p, p * 2));
  const o2 = o1;
  try {
    yield fail(given[0] > p);
    out += o1.y;
  } catch {
    o1 = new Other(o1.x + 1, o1.y);
  }
  out += o2.x;
  yield p;
  out += " " + (o1 === o2);
  const pair = new Pair(o1, o2);
  out += " " + (pair.a === pair.b) + pair.a.x + "," + pair.b.x;
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
