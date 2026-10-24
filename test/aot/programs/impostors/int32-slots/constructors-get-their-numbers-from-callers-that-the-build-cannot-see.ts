// `new Point(3, 4)` wherever the build looks: the constructor's parameters, a parameter property and a field initializer that uses a parameter all look like small integers, and the new object can be born with them in its slots.
// Hidden constructions bring the other numbers: Reflect.construct, a bound constructor, the class kept on the global object, a subclass made from text at run time, and a constructor function run by call.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
const odd: number[] = (
  JSON.parse(
    '["0.5","-0.5","-0","NaN","Infinity","-Infinity","2147483647","2147483648","-2147483643","-2147483644","-2147483645","-2147483646","-2147483647","-2147483648","-2147483649","4294967295","4294967296","1e21","5e-324","9007199254740993"]'
      .split("")
      .join(""),
  ) as string[]
).map(Number);
function exact(value: unknown): string {
  if (typeof value !== "number") return `${typeof value}:${String(value)}`;
  return `${Object.is(value, -0) ? "-0" : value}${Number.isInteger(value) ? "" : "~"}`;
}
class Point {
  x: number;
  y: number;
  sum: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.sum = x + y;
  }
}
class Sized {
  twice: number;
  constructor(public size: number) {
    this.twice = size + size;
  }
}
class Initialized {
  base: number;
  next = 0;
  constructor(base: number) {
    this.base = base;
    this.next = this.base + 1;
  }
}
interface Old { a: number; b: number }
function Old(this: Old, a: number) {
  this.a = a;
  this.b = a - 1;
}
const OldClass = Old as unknown as new (a: number) => Old;
function show(object: object) {
  return `${Object.values(object).map(exact).join(",")} ${JSON.stringify(object)} [${Object.keys(object)}]`;
}
function usePoint(point: Point) {
  return `${exact(point.x + point.y)} ${exact(point.sum - point.x)} ${exact(point.x * 1)}`;
}
let sum = 0;
for (let i = 0; i < 2000; i++) {
  const p = new Point(i & 31, 3), s = new Sized(i & 31), n = new Initialized(i & 31), o = new OldClass(i & 31);
  handOver(p); handOver(s); handOver(n); handOver(o);
  sum += p.sum + s.twice + n.next + o.b;
}
console.log("warm", sum);
(globalThis as any).KeptPoint = Point;
const Heir = new Function("Base", JSON.parse('["return class Heir extends Base"," { constructor(v) { super(v, v) } }"]').join("")) (Point) as new (v: number) => Point;
for (const value of odd) {
  const made: [string, object][] = [
    ["Reflect.construct", Reflect.construct(Point, [value, 1])],
    ["bound", new (Point.bind(undefined, 1))(value)],
    ["a global", new (globalThis as any).KeptPoint(value, value)],
    ["an heir from text", new Heir(value)],
    ["a parameter property", Reflect.construct(Sized, [value])],
    ["an initializer", Reflect.construct(Initialized, [value])],
    ["a constructor function", Reflect.construct(OldClass, [value])],
    ["a constructor function by call", (() => { const bare = Object.create(Old.prototype); Old.call(bare, value); return bare; })()],
  ];
  console.log(exact(value) + ":");
  for (const [label, object] of made) console.log(`  ${label}: ${show(object)}${object instanceof Point ? " " + usePoint(object) : ""}`);
}
console.log("ordinary ones afterwards:", show(new Point(1, 2)), show(new Sized(3)), show(new Initialized(4)), show(new OldClass(5)));
