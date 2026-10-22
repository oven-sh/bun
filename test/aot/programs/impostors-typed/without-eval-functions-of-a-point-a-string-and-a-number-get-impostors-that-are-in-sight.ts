function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || value === undefined) return String(value);
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  return typeof value;
}

const log: string[] = [];

function attempt(label: string, run: () => unknown): void {
  log.length = 0;
  try {
    console.log(label, "->", show(run()), log.join(" "));
  } catch (error) {
    console.log(label, "threw", error instanceof Error ? error.constructor.name : typeof error, log.join(" "));
  }
}

interface Point {
  x: number;
  y: number;
}

function sum(p: Point): number {
  return p.x + p.y;
}

function move(p: Point): number {
  p.x += 1;
  return p.x;
}

function code(s: string): number {
  return s.charCodeAt(0) + s.length;
}

function glued(s: string): string {
  return s + "!";
}

function half(n: number): number {
  return n / 2;
}

function next(n: number): number {
  return n + 1;
}

function whole(n: number): number {
  return n | 0;
}

class Other {
  x = 1;
  y = 2;
}

class Accessors {
  get x(): number {
    log.push("get-x");
    return 1;
  }
  set x(value: number) {
    log.push("set-x:" + value);
  }
  y = 2;
}

function honest(label: string): void {
  const p: Point = { x: 1, y: 2 };
  console.log(label, sum({ x: 3, y: 4 }), sum(p), move(p), code("a"), glued("a"), half(3), next(1), whole(1.5));
}

const points: [string, () => any][] = [
  ["a point", () => ({ x: 1, y: 2 })],
  ["the other order", () => ({ y: 2, x: 1 })],
  ["more members", () => ({ z: 3, x: 1, y: 2 })],
  ["a string inside", () => ({ x: "1", y: 2 })],
  ["a bigint inside", () => ({ x: 1n, y: 2 })],
  ["no y", () => ({ x: 1 })],
  ["empty", () => ({})],
  ["negative zeros", () => ({ x: -0, y: -0 })],
  ["getters", () => ({ get x() { log.push("get-x"); return 1; }, get y() { log.push("get-y"); return 2; } })],
  ["valueOf", () => ({ x: { valueOf: () => (log.push("x.valueOf"), 1) }, y: { valueOf: () => (log.push("y.valueOf"), 2) } })],
  ["another class", () => new Other()],
  ["a class with accessors", () => new Accessors()],
  ["inherited", () => Object.create({ x: 1, y: 2 })],
  ["no prototype", () => Object.assign(Object.create(null), { x: 1, y: 2 })],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, { get: (t, k, r) => (log.push("get:" + String(k)), Reflect.get(t, k, r)), set: (t, k, v, r) => (log.push("set:" + String(k)), Reflect.set(t, k, v, r)) })],
  ["an array", () => [1, 2]],
  ["a function", () => Object.assign(() => 1, { x: 1, y: 2 })],
  ["a string", () => "xy"],
  ["a number", () => 5],
  ["null", () => null],
  ["undefined", () => undefined],
  ["parsed", () => JSON.parse('{"x":1,"y":2}')],
  ["parsed with a string", () => JSON.parse('{"y":"2","x":1}')],
];

const strings: [string, () => any][] = [
  ["a string", () => "abc"],
  ["empty", () => ""],
  ["a String object", () => new String("abc")],
  ["an array", () => ["a", "b"]],
  ["a look-alike", () => ({ charCodeAt: () => -1, length: 2, toString: () => (log.push("toString"), "look") })],
  ["bytes", () => Buffer.from("abc")],
  ["a number", () => 65],
  ["a symbol", () => Symbol("s")],
  ["null", () => null],
  ["undefined", () => undefined],
];

const numbers: [string, () => any][] = [
  ["a number", () => 3],
  ["a string", () => "3"],
  ["an empty string", () => ""],
  ["a bigint", () => 3n],
  ["negative zero", () => -0],
  ["not a number", () => NaN],
  ["past 32 bits", () => 2147483648],
  ["null", () => null],
  ["undefined", () => undefined],
  ["true", () => true],
  ["an array", () => [3]],
  ["valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["toPrimitive", () => ({ [Symbol.toPrimitive]: (hint: string) => (log.push(hint), 3) })],
  ["a date", () => new Date(3)],
  ["a symbol", () => Symbol()],
];

honest("honest before");
let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + move({ x: i, y: 1 }) + code("k") + glued("a").length + half(i) + next(i) + whole(i);
console.log("2000 honest rounds", warm);

for (const [name, make] of points) {
  attempt("sum " + name, () => sum(make()));
  attempt("move " + name, () => move(make()));
}
for (const [name, make] of strings) {
  attempt("code " + name, () => code(make()));
  attempt("glued " + name, () => glued(make()));
}
for (const [name, make] of numbers) {
  attempt("half " + name, () => half(make()));
  attempt("next " + name, () => next(make()));
  attempt("whole " + name, () => whole(make()));
}

attempt("written at the call", () => [sum({ x: "1", y: 2 } as any), sum({ x: 1 } as Point), code(["a"] as any), glued(5 as any), half("8" as any), next("8" as unknown as number), whole("8.5" as any)]);

honest("honest after");
