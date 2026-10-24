// validate<T>(value) takes what no JSON text can hold: undefined, NaN, bigints, instances of classes, getters, proxies, holes, symbols, cycles. An object is spread once, and what T declares is read from that copy.
import { validate } from "bun:bundle";
import type { Schema } from "bun";
interface Point { x: number; y: number }
function attempt(what: string, run: () => unknown): void {
  try {
    console.log(what, show(run()));
  } catch (error) {
    const issues = (error as Partial<Schema.Error>).issues;
    console.log(what, (error as Error).constructor.name, issues ? issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; ") : (error as Error).message);
  }
}
function show(value: unknown): string {
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) return String(typeof value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + Array.from(value, show).join() + "]";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show((value as any)[key])).join() + "}";
}

attempt("undefined for an optional member", () => validate<{ a?: number; b: number }>({ a: undefined, b: 1 }));
attempt("undefined for a member that may be undefined", () => validate<{ a: number | undefined; b: number }>({ a: undefined, b: 1 }));
attempt("that member absent", () => validate<{ a: number | undefined; b: number }>({ b: 1 }));
attempt("undefined for unknown", () => validate<{ a: unknown }>({ a: undefined }));
attempt("undefined for a number", () => validate<{ a: number }>({ a: undefined }));
attempt("undefined itself", () => validate<number | undefined>(undefined));
attempt("undefined for an object", () => validate<Point>(undefined));
attempt("undefined in an array", () => validate<(number | undefined)[]>([1, undefined]));
attempt("a hole in an array", () => validate<number[]>([1, , 3]));
attempt("a hole where undefined fits", () => validate<(number | undefined)[]>([1, , 3]));
attempt("NaN, Infinity", () => validate<Point>({ x: NaN, y: -Infinity }));
attempt("-0", () => validate<Point>({ x: -0, y: 0 }));
attempt("a bigint", () => validate<{ big: bigint }>({ big: 5n }));
attempt("a number for a bigint", () => validate<{ big: bigint }>({ big: 5 }));
attempt("a bigint for a number", () => validate<{ n: number }>({ n: 5n }));
attempt("wrapped primitives", () => validate<{ s: string; n: number; b: boolean }>({ s: new String("s"), n: new Number(1), b: new Boolean(true) }));

class Vector {
  z = 3;
  constructor(public x: number, public y: number) {}
  get length(): number { return Math.hypot(this.x, this.y); }
  double(): Vector { return new Vector(this.x * 2, this.y * 2); }
}
const vector = new Vector(3, 4);
const fromVector = validate<Point>(vector);
console.log("an instance of a class", show(fromVector), fromVector instanceof Vector, Object.getPrototypeOf(fromVector) === Object.prototype, "length" in fromVector, vector instanceof Vector, show(vector));
attempt("a getter of its class is not its own", () => validate<{ x: number; length: number }>(vector));
attempt("an inherited member is not its own", () => validate<Point>(Object.create({ x: 1, y: 2 })));
attempt("a member that is not enumerable", () => validate<Point>(Object.defineProperty({ x: 1 }, "y", { value: 2, enumerable: false })));
const bare = validate<Point>(Object.assign(Object.create(null), { x: 1, y: 2 }));
console.log("no prototype", show(bare), Object.getPrototypeOf(bare) === Object.prototype);
attempt("a Date for an object type", () => validate<{ x?: number }>(new Date(0)));
attempt("a Map for an object type", () => validate<{ x?: number }>(new Map([[1, 2]])));
attempt("a function for an object type", () => validate<{ x?: number }>(() => 1));
attempt("an array for an object type", () => validate<{ length: number }>([1, 2]));
attempt("an object for an array type", () => validate<number[]>({ 0: 1, length: 1 }));
const date = new Date(0), map = new Map([[1, 2]]), call = (): number => 1, mark = Symbol("mark");
const heldAsIs = validate<{ a: unknown; b: any; c: object; d: unknown; e: object; f: unknown }>({ a: date, b: map, c: vector, d: mark, e: [vector], f: call });
console.log("under unknown, any, object", heldAsIs.a === date, heldAsIs.b === map, heldAsIs.c === vector, heldAsIs.d === mark, (heldAsIs.e as unknown[])[0] === vector, heldAsIs.f === call);
attempt("a function under object", () => validate<{ a: object }>({ a: call }).a === call);
attempt("a key that is a symbol", () => validate<Point>({ x: 1, [mark]: "kept", y: 2 }));

const reads: string[] = [];
const withGetters = {
  get x(): number { reads.push("x"); return 1; },
  get more(): number { reads.push("more"); return 3; },
  get y(): number { reads.push("y"); return reads.length; },
  get inner(): { x: number; y: number } { reads.push("inner"); return { get x(): number { reads.push("inner.x"); return 4; }, y: 5 }; },
};
const fromGetters = validate<Point & { inner: Point }>(withGetters);
console.log("getters", reads.join(), show(fromGetters), Object.getOwnPropertyDescriptor(fromGetters, "x")!.get === undefined, Object.getOwnPropertyDescriptor(fromGetters.inner, "x")!.writable);
attempt("a getter that throws", () => validate<Point>({ x: 1, get y(): number { throw new RangeError("from a getter"); } }));
let turn = 0;
attempt("a getter that fits once", () => validate<{ a: number }>({ get a(): unknown { return turn++ ? "text" : 1; } }));
attempt("a getter that misfits once", () => validate<{ a: number }>({ get a(): unknown { return turn++ === 1 ? "text" : 1; } }));
console.log("reads", turn);

const traps: Record<string, number> = {};
const counting = (target: object): unknown => new Proxy(target, {
  ownKeys(held) { traps.ownKeys = (traps.ownKeys ?? 0) + 1; return Reflect.ownKeys(held); },
  getOwnPropertyDescriptor(held, key) { traps["describe " + String(key)] = (traps["describe " + String(key)] ?? 0) + 1; return Reflect.getOwnPropertyDescriptor(held, key); },
  get(held, key, receiver) { traps["get " + String(key)] = (traps["get " + String(key)] ?? 0) + 1; return Reflect.get(held, key, receiver); },
  has(held, key) { traps["has " + String(key)] = (traps["has " + String(key)] ?? 0) + 1; return Reflect.has(held, key); },
  getPrototypeOf(held) { traps.getPrototypeOf = (traps.getPrototypeOf ?? 0) + 1; return Reflect.getPrototypeOf(held); },
  set() { traps.set = (traps.set ?? 0) + 1; return false; },
  defineProperty() { traps.defineProperty = (traps.defineProperty ?? 0) + 1; return false; },
  deleteProperty() { traps.deleteProperty = (traps.deleteProperty ?? 0) + 1; return false; },
});
const target = { x: 1, more: "m", y: 2 };
const fromProxy = validate<Point>(counting(target));
console.log("a proxy of an object", show(fromProxy), JSON.stringify(traps), show(target));
for (const name of Object.keys(traps)) delete traps[name];
attempt("a proxy of an array", () => validate<number[]>(counting([1, 2])));
console.log(JSON.stringify(traps));
for (const name of Object.keys(traps)) delete traps[name];
attempt("a proxy that is refused", () => validate<Point>(counting({ x: "1", y: 2 })));
console.log(JSON.stringify(traps));

const cycle: any = { name: "cycle" };
cycle.self = cycle;
const around = validate<{ held: unknown; also: any; list: unknown[] }>({ held: cycle, also: cycle, list: [cycle] });
console.log("a cycle under unknown", around.held === cycle, around.also === cycle, around.list[0] === cycle, (around.held as any).self.self === cycle);
const undeclaredCycle: any = { x: 1, y: 2 };
undeclaredCycle.self = undeclaredCycle;
const unrolled = validate<Point>(undeclaredCycle) as Point & { self: unknown };
console.log("a cycle under an undeclared key", unrolled.self === undeclaredCycle, (unrolled as unknown) !== undeclaredCycle);

type Tagged = { kind: "a"; a: number } | { kind: "b"; b: Point };
type Untagged = { a: number; b: string } | { a: number; c: string };
type Filled = { a: number; size: number & Schema.Default<1>; b: string } | { a: number; size: number & Schema.Default<2>; c: string };
let timesRead = 0;
attempt("a getter that throws in an object without the tag", () => validate<Tagged>({ x: 1, get y() { throw new RangeError("mine"); } }));
attempt("a getter for the tag", () => validate<Tagged>({ get kind() { timesRead++; return "b"; }, b: { x: 1, y: 2 } }));
console.log("the tag was read", timesRead);
timesRead = 0;
attempt("a getter where the second of two types fits", () => validate<Untagged>({ get a() { timesRead++; return 1; }, c: "c" }));
console.log("it was read", timesRead);
timesRead = 0;
attempt("the same where both types fill a member in", () => validate<Filled>({ get a() { timesRead++; return 1; }, c: "c" }));
console.log("it was read", timesRead);
