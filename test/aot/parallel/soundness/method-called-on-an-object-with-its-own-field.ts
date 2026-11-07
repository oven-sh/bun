// A method that an object inherits from an instance, reached through values that flow does not follow.
// The object also has a field of its own under a name of the class.
type Flat = Point | Other;
const seen: string[] = [];
class Point {
  x: number;
  y: number;
  link: unknown = null;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  is(other: unknown): boolean {
    return this === other;
  }
  keys(): string { return Object.keys(this).join("+"); }
  own(): string { return Object.getOwnPropertyNames(this).join("+"); }
  json(): string { return JSON.stringify(this); }
  spread(): string { return JSON.stringify({ ...this }); }
  has(): string { return [Object.hasOwn(this, "x"), "x" in this, this.hasOwnProperty("y")].join("+"); }
  loop(): string { let text = ""; for (const name in this) text += name + "+"; return text; }
  frozen(): string { return [Object.isFrozen(this), Object.isExtensible(this)].join("+"); }
  proto(): boolean { return Object.getPrototypeOf(this) === Object.getPrototypeOf(Object.getPrototypeOf(this)); }
  readY(): number { return this.y; }
  storeY(): string { this.y = 9; return Object.keys(this).join("+") + this.y; }
  sum(other: Point): number {
    return this.x * 100 + other.x;
  }
}
class Other {
  x: number;
  y: number;
  link: unknown = null;
  tag = "other";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  is(other: unknown): boolean {
    return this === other;
  }
  keys(): string { return Object.keys(this).join("+"); }
  own(): string { return Object.getOwnPropertyNames(this).join("+"); }
  json(): string { return JSON.stringify(this); }
  spread(): string { return JSON.stringify({ ...this }); }
  has(): string { return [Object.hasOwn(this, "x"), "x" in this, this.hasOwnProperty("y")].join("+"); }
  loop(): string { let text = ""; for (const name in this) text += name + "+"; return text; }
  frozen(): string { return [Object.isFrozen(this), Object.isExtensible(this)].join("+"); }
  proto(): boolean { return Object.getPrototypeOf(this) === Object.getPrototypeOf(Object.getPrototypeOf(this)); }
  readY(): number { return this.y; }
  storeY(): string { this.y = 9; return Object.keys(this).join("+") + this.y; }
  sum(other: Flat): number {
    return this.x * 1000 + other.x;
  }
}
const given: number[] = JSON.parse("[0.5, 1, 2, 3]");
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  return o.constructor.name;
}
function fail(when: boolean): void {
  if (when) throw new Error("no");
}
function* echo(): Generator<unknown, void, Flat> {
  for (let sent: Flat = yield; ; sent = yield sent);
}
const echoes = echo();
echoes.next();
function sent(o: Flat): Flat {
  return echoes.next(o).value as Flat;
}
function revived(o: Flat): Flat {
  return JSON.parse("[0]", (key, value) => (key === "0" ? o : value))[0];
}
async function run2(p: number): Promise<string> {
  let out = "";
  const put = (o: Flat) => void (o1 = o);
  let o1: Flat = sent(new Point(p * 2, given[2]));
  const o2 = o1;
  try {
    await null;
    fail(given[0] > p);
    out += o2.x;
  } catch {
    put(new Other(o1.x + 1, o1.y));
  }
  const { x } = o2;
  out += x;
  out += show(o1);
  o1.link = o2;
  out += " " + (o1.link === o1) + (o1.link === o2);
  return out;
}
async function run6(p: number): Promise<string> {
  let out = "";
  let o1: Flat = revived(new Point(given[0], 0));
  let o2 = o1;
  try {
    await null;
    await fail(p === 5);
    out += o2.x;
  } catch {
    o1 = Object.create(o1) as Flat;
    (o1 as any).y = "text";
  }
  out += o2.x;
  out += show(o1);
  await null;
  out += " " + (o1 instanceof Point) + (o2 instanceof Point) + ("tag" in o1) + ("tag" in o2);
  out += " " + o1.sum(o2 as Point) + "," + o2.sum(o1 as Point);
  out += " " + typeof o1.readY() + " " + o1.has() + " " + o1.keys() + " " + o1.json() + " " + o1.spread() + " " + o1.frozen();
  out += " " + o1.storeY();
  return out;
}
{
  const lines: string[] = [];
  for (let round = 0; round < 12; round++) lines.push(await run2(round));
  console.log("2: " + lines.join(" | "));
}
{
  const lines: string[] = [];
  for (let round = 0; round < 12; round++) lines.push(await run6(round));
  console.log("6: " + lines.join(" | "));
}
