// Values that are no plain data are handed to validate<T>, and made by revivers for JSON.parse<T>: proxies, accessors, holes, frozen objects, instances, host objects, objects that change while they are read. Each call ends in a value or in an error that can be caught; what is returned is read, written and kept.
import { validate } from "bun:bundle";
type Point = { x: number; y: number };
type Named = { name: string; point: Point; tags: string[]; extra?: unknown };
type Pair = [Point, string];
type Table = Record<string, Point>;
type Shape = { kind: "a"; a: number } | { kind: "b"; b: Point };
type Tree = { name: string; kids: Tree[] };

class Instance {
  x = 1;
  y = 2;
  get z() {
    return 3;
  }
}
class Heir extends Instance {
  w = 4;
}
const makers: [string, () => any][] = [
  ["a plain object", () => ({ x: 1, y: 2 })],
  ["another order", () => ({ y: 2, x: 1 })],
  ["more keys", () => ({ a: 0, x: 1, b: 0, y: 2, c: 0 })],
  ["no prototype", () => Object.assign(Object.create(null), { x: 1, y: 2 })],
  ["inherited members", () => Object.create({ x: 1, y: 2 })],
  ["one inherited member", () => Object.assign(Object.create({ x: 1 }), { y: 2 })],
  ["an instance", () => new Instance()],
  ["an heir", () => new Heir()],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["sealed", () => Object.seal({ x: 1, y: 2 })],
  ["not extensible", () => Object.preventExtensions({ x: 1, y: 2 })],
  ["an accessor", () => ({ x: 1, get y() { return 2; } })],
  ["an accessor that changes", () => { let reads = 0; return { x: 1, get y() { return reads++ ? "two" : 2; } }; }],
  ["an accessor that changes at the third read", () => { let reads = 0; return { x: 1, get y() { return reads++ > 1 ? { no: 1 } : 2; } }; }],
  ["a proxy that changes", () => { let reads = 0; return new Proxy({ x: 1, y: 2 }, { get: (target: any, key) => (key === "y" && reads++ ? "two" : target[key]) }); }],
  ["an accessor that throws", () => ({ x: 1, get y() { throw new RangeError("mine"); } })],
  ["an accessor that deletes", () => { const o: any = { get x() { delete o.y; return 1; }, y: 2 }; return o; }],
  ["an accessor that adds", () => { const o: any = { get x() { for (let i = 0; i < 100; i++) o["k" + i] = i; return 1; }, y: 2 }; return o; }],
  ["a setter only", () => Object.defineProperty({ x: 1 }, "y", { set() {}, enumerable: true, configurable: true })],
  ["not enumerable", () => Object.defineProperty({ x: 1 }, "y", { value: 2, enumerable: false })],
  ["not writable", () => Object.defineProperty({ x: 1 }, "y", { value: 2, enumerable: true, writable: false })],
  ["symbols", () => ({ x: 1, y: 2, [Symbol("s")]: 3, [Symbol.iterator]: 4, [Symbol.toPrimitive]: 5 })],
  ["index keys", () => ({ 0: "zero", x: 1, 5: "five", y: 2, 4294967294: "last", 4294967295: "name" })],
  ["__proto__ as a key", () => JSON.parse('{"x":1,"__proto__":{"y":2},"y":2}')],
  ["many keys", () => { const o: any = { x: 1 }; for (let i = 0; i < 2000; i++) o["k" + i] = i; o.y = 2; return o; }],
  ["keys deleted", () => { const o: any = { a: 1, x: 1, b: 2, y: 2 }; delete o.a; delete o.b; return o; }],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, {})],
  ["a proxy that lies", () => new Proxy({}, { get: (_, key) => (key === "x" || key === "y" ? 1 : undefined), has: () => true, ownKeys: () => ["x", "y"], getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true, writable: true }) })],
  ["a proxy that throws", () => new Proxy({ x: 1, y: 2 }, { get() { throw new EvalError("mine"); }, ownKeys() { throw new EvalError("mine"); } })],
  ["a revoked proxy", () => { const made = Proxy.revocable({ x: 1, y: 2 }, {}); made.revoke(); return made.proxy; }],
  ["a proxy of an array", () => new Proxy([{ x: 1, y: 2 }, "s"], {})],
  ["an array", () => [{ x: 1, y: 2 }, "s"]],
  ["an array with members", () => Object.assign([{ x: 1, y: 2 }, "s"], { x: 1, y: 2, name: "n" })],
  ["holes", () => [{ x: 1, y: 2 }, , "s"]],
  ["a hole first", () => [, "s"]],
  ["a long empty array", () => new Array(100000)],
  ["a sparse array", () => { const a: any[] = []; a[50000] = "s"; return a; }],
  ["an array with an accessor", () => Object.defineProperty([{ x: 1, y: 2 }, "s"], 0, { get: () => ({ x: 1, y: 2 }) })],
  ["an array whose accessor shrinks it", () => { const a: any[] = [1, "s", 3, 4]; Object.defineProperty(a, 0, { get() { a.length = 1; return { x: 1, y: 2 }; } }); return a; }],
  ["a frozen array", () => Object.freeze([{ x: 1, y: 2 }, "s"])],
  ["an heir of Array", () => { class List extends Array {} return List.from([{ x: 1, y: 2 }, "s"]); }],
  ["an array of numbers", () => [1, 2, 3]],
  ["an array of fractions", () => [1.5, 2.5]],
  ["array-like", () => ({ length: 2, 0: { x: 1, y: 2 }, 1: "s" })],
  ["arguments", () => (function (..._: any[]) { return arguments; })({ x: 1, y: 2 }, "s")],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a Float64Array", () => new Float64Array([1.5, 2.5])],
  ["an ArrayBuffer", () => new ArrayBuffer(8)],
  ["a function", () => Object.assign(function f() {}, { x: 1, y: 2 })],
  ["an arrow", () => Object.assign(() => {}, { x: 1, y: 2, name2: "n" })],
  ["a class", () => Instance],
  ["a bound function", () => Object.assign(function () {}.bind(null), { x: 1, y: 2 })],
  ["a Date", () => Object.assign(new Date(0), { x: 1, y: 2 })],
  ["a RegExp", () => Object.assign(/r/, { x: 1, y: 2 })],
  ["a Map", () => Object.assign(new Map([["x", 1]]), { x: 1, y: 2 })],
  ["a Set", () => new Set([1])],
  ["a WeakMap", () => new WeakMap()],
  ["a Promise", () => Object.assign(Promise.resolve(1), { x: 1, y: 2 })],
  ["an Error", () => Object.assign(new Error("e"), { x: 1, y: 2 })],
  ["a String object", () => Object.assign(new String("st"), { x: 1, y: 2 })],
  ["a Number object", () => Object.assign(new Number(1), { x: 1, y: 2 })],
  ["a Boolean object", () => new Boolean(false)],
  ["a symbol", () => Symbol("s")],
  ["a bigint", () => 10n],
  ["undefined", () => undefined],
  ["null", () => null],
  ["NaN", () => NaN],
  ["Infinity", () => ({ x: Infinity, y: -Infinity })],
  ["-0", () => ({ x: -0, y: 0 })],
  ["a generator", () => (function* () { yield 1; })()],
  ["an iterator", () => [1, 2][Symbol.iterator]()],
  ["Math", () => Math],
  ["JSON", () => JSON],
  ["a cycle", () => { const o: any = { x: 1, y: 2, name: "n", kids: [], tags: [] }; o.point = o; o.kids.push(o); o.extra = o; return o; }],
  ["shared parts", () => { const p = { x: 1, y: 2 }; return { name: "n", point: p, tags: [], extra: p, a: p, b: p, kind: "b" }; }],
  ["a typed object", () => JSON.parse<Point>('{"x":1,"y":2}')],
  ["a typed object with more keys", () => JSON.parse<Point>('{"u":0,"x":1,"v":0,"y":2,"w":0}')],
  ["a typed object of another type", () => JSON.parse<Named>('{"name":"n","point":{"x":1,"y":2},"tags":["t"],"x":1,"y":2}')],
  ["a frozen typed object", () => Object.freeze(JSON.parse<Point>('{"x":1,"y":2}'))],
  ["a typed object changed", () => { const p: any = JSON.parse<Point>('{"x":1,"y":2}'); delete p.x; p.x = 5; p.z = 6; return p; }],
  ["a typed object with an accessor", () => Object.defineProperty(JSON.parse<Point>('{"x":1,"y":2}'), "y", { get: () => 7, enumerable: true, configurable: true })],
  ["a typed object with another prototype", () => Object.setPrototypeOf(JSON.parse<Point>('{"x":1,"y":2}'), { z: 1 })],
];

const places: [string, (value: any) => any][] = [
  ["itself", value => value],
  ["a member", value => ({ name: "n", point: value, tags: ["t"], extra: value })],
  ["tags", value => ({ name: "n", point: { x: 1, y: 2 }, tags: value })],
  ["an element", value => [value, "s"]],
  ["a dictionary's member", value => ({ a: { x: 1, y: 2 }, b: value })],
  ["under a tag", value => ({ kind: "b", b: value })],
  ["a kid", value => ({ name: "r", kids: [{ name: "k", kids: [] }, value] })],
];
const validators: [string, (value: unknown) => unknown][] = [
  ["Point", value => validate<Point>(value)],
  ["Named", value => validate<Named>(value)],
  ["Pair", value => validate<Pair>(value)],
  ["Table", value => validate<Table>(value)],
  ["Shape", value => validate<Shape>(value)],
  ["Tree", value => validate<Tree>(value)],
  ["Point[]", value => validate<Point[]>(value)],
  ["unknown[]", value => validate<unknown[]>(value)],
  ["{ v?: unknown }", value => validate<{ v?: unknown }>(value)],
];

function use(value: any, depth = 0): number {
  if (typeof value !== "object" || value === null || depth > 3) return 1;
  let count = 1;
  for (const key of Object.keys(value).slice(0, 20)) count += use(value[key], depth + 1);
  return count;
}
const kept: unknown[] = [];
let unfit = 0;
const outcomes = new Map<string, number>();
for (const [, place] of places) {
  for (const [, make] of makers) {
    for (const [, validate] of validators) {
      let said = "";
      try {
        const value = validate(place(make()));
        use(value);
        try {
          validate(value);
        } catch {
          unfit++;
        }
        try {
          JSON.stringify(value);
        } catch {}
        kept[kept.length % 50] = value;
        said = "a value";
      } catch (error: any) {
        said = error?.name === "TypeError" && error.issues?.length > 0 ? "refused" : "thrown: " + error?.name;
      }
      outcomes.set(said, (outcomes.get(said) ?? 0) + 1);
    }
  }
}
for (const value of kept) use(value);
console.log("validate: " + [...outcomes].sort().map(([said, count]) => count + " " + said).join(", ") + "; values that are refused when validated again: " + unfit);

outcomes.clear();
const text = '{"name":"n","point":{"x":1,"y":2},"tags":["t","u"],"extra":{"deep":[1,{"x":1,"y":2}]}}';
const targets = ["", "name", "point", "x", "y", "tags", "0", "1", "extra", "deep"];
for (const target of targets) {
  for (const [, make] of makers) {
    let said = "";
    try {
      const value = JSON.parse<Named>(text, (key, held) => (key === target ? make() : held));
      use(value);
      try {
        JSON.stringify(value);
      } catch {}
      kept[kept.length % 50] = value;
      said = "a value";
    } catch (error: any) {
      said = error?.name === "TypeError" && error.issues?.length > 0 ? "refused" : "thrown: " + error?.name;
    }
    outcomes.set(said, (outcomes.get(said) ?? 0) + 1);
  }
}
const revivers: [string, (this: any, key: string, held: any) => any][] = [
  ["changes nothing", (_, held) => held],
  ["drops everything", () => undefined],
  ["throws at once", () => { throw new RangeError("mine"); }],
  ["throws at the root", (key, held) => { if (key === "") throw new RangeError("mine"); return held; }],
  ["deletes what comes next", function (key, held) { if (key === "name") delete this.point; return held; }],
  ["replaces what comes next", function (key, held) { if (key === "name") this.point = { x: "no" }; return held; }],
  ["adds members", function (key, held) { if (key === "x") for (let i = 0; i < 300; i++) this["k" + i] = i; return held; }],
  ["shortens the array", function (key, held) { if (key === "0" && Array.isArray(this)) this.length = 0; return held; }],
  ["lengthens the array", function (key, held) { if (key === "0" && Array.isArray(this)) this.push("more"); return held; }],
  ["freezes the holder", function (_, held) { Object.freeze(this); return held; }],
  ["parses again", (_, held) => { JSON.parse<Named>(text); return held; }],
  ["parses again with a reviver", (key, held) => (key === "x" ? JSON.parse<Point>('{"x":1,"y":2}', (_, inner) => inner).x : held)],
  ["validates the holder", function (_, held) { try { validate<Point>(this); } catch {} return held; }],
  ["returns the holder", function (key, held) { return key === "extra" ? this : held; }],
];
for (const [label, reviver] of revivers) {
  let said = "";
  try {
    const value = JSON.parse<Named>(text, reviver);
    use(value);
    said = "a value";
  } catch (error: any) {
    said = error?.name === "TypeError" && error.issues?.length > 0 ? "refused" : "thrown: " + error?.name;
  }
  console.log("a reviver that " + label + ": " + said);
}
console.log("revivers that put something in: " + [...outcomes].sort().map(([said, count]) => count + " " + said).join(", "));
console.log("afterwards: " + JSON.stringify(JSON.parse<Named>(text)) + " " + JSON.stringify(validate<Point>({ x: 1, y: 2 })));
