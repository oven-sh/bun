// validate<T>() learns about the objects of one shape once. Every way in which the next object can differ from the last one is tried here, again and again, in turn:
// other orders of keys, members left out, keys that hold undefined, undeclared keys, getters, other prototypes, frozen objects, dictionaries, objects with many members, shapes that die.
import type { Schema } from "bun";
import { validate } from "bun:bundle";

type Point = { x: number; y: number; label?: string; tags?: string[] };
type StrictPoint = Point & Schema.Strict;
type Nested = { name: string; at: Point; corners: Point[]; next?: Nested };
type OnlyOptional = { a?: number; b?: string; c?: boolean };
type MayBeUndefined = { a: number | undefined; b?: number | undefined };
type WithDefault = { port: number & Schema.Default<8080>; host: string };
type Wide = {
  m00?: number; m01?: number; m02?: number; m03?: number; m04?: number; m05?: number; m06?: number; m07?: number; m08?: number; m09?: number;
  m10?: number; m11?: number; m12?: number; m13?: number; m14?: number; m15?: number; m16?: number; m17?: number; m18?: number; m19?: number;
  m20?: number; m21?: number; m22?: number; m23?: number; m24?: number; m25?: number; m26?: number; m27?: number; m28?: number; m29?: number;
  m30?: number; m31?: number; m32?: number; m33?: number; m34?: number; m35?: number; m36?: number; m37?: number; m38?: number; m39?: number;
  m40?: number; m41?: number; m42?: number; m43?: number; m44?: number; m45?: number; m46?: number; m47?: number; m48?: number; m49?: number;
  m50?: number; m51?: number; m52?: number; m53?: number; m54?: number; m55?: number; m56?: number; m57?: number; m58?: number; m59?: number;
  m60?: number; m61?: number; m62?: number; m63?: number; m64?: number; m65?: number; m66?: number; m67?: number; m68?: number; m69?: number;
  id: number;
};

function describe(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(describe).join(",") + "]";
  if (typeof value !== "object" || value === null) return typeof value === "string" ? JSON.stringify(value) : String(value);
  const parts: string[] = [];
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const marks = (descriptor.writable ? "" : "!w") + (descriptor.enumerable ? "" : "!e") + (descriptor.configurable ? "" : "!c");
    parts.push(String(key) + marks + ":" + describe(descriptor.value));
  }
  return "{" + parts.join(",") + "}" + (Object.getPrototypeOf(value) === Object.prototype ? "" : "^") + (Object.isExtensible(value) ? "" : "#");
}

function tried(run: () => unknown, source: unknown): string {
  try {
    const result = run();
    return describe(result) + (result === source ? " THE SOURCE ITSELF" : "") + " | in:" + Object.keys(result as object).join() + " | json:" + JSON.stringify(result);
  } catch (error) {
    const issues = (error as Schema.Error).issues;
    return (error as Error).name + " " + (issues ? issues.map(issue => issue.path.join(".") + ":" + issue.code).join(" ") : (error as Error).message);
  }
}

let getterRuns = 0;
const withGetter = () => Object.defineProperty({ x: 1 } as Record<string, unknown>, "y", { get() { getterRuns++; return 2; }, enumerable: true, configurable: true });
const hidden = () => Object.defineProperty({ x: 1, y: 2 } as Record<string, unknown>, "label", { value: "hidden", enumerable: false, writable: true, configurable: true });
const readOnly = () => Object.defineProperty({ x: 1 } as Record<string, unknown>, "y", { value: 2, enumerable: true, writable: false, configurable: true });
function dictionary(): Record<string, unknown> {
  const object: Record<string, unknown> = {};
  for (let i = 0; i < 200; i++) object["k" + i] = i;
  for (let i = 0; i < 200; i++) delete object["k" + i];
  object.x = 1;
  object.y = 2;
  return object;
}
class Pair { x = 1; y = 2; }

const pointSources: [string, () => unknown][] = [
  ["x y", () => ({ x: 1, y: 2 })],
  ["y x", () => ({ y: 2, x: 1 })],
  ["parsed x y", () => JSON.parse('{"x":1,"y":2}')],
  ["parsed y x label", () => JSON.parse('{"y":2,"x":1,"label":"l"}')],
  ["label first", () => ({ label: "l", x: 1, y: 2 })],
  ["tags between", () => ({ x: 1, tags: ["a", "b"], y: 2 })],
  ["all four", () => ({ x: 1, y: 2, label: "l", tags: [] })],
  ["all four backwards", () => ({ tags: ["t"], label: "l", y: 2, x: 1 })],
  ["label undefined", () => ({ x: 1, y: 2, label: undefined })],
  ["label undefined first", () => ({ label: undefined, x: 1, y: 2 })],
  ["tags undefined, label there", () => ({ x: 1, tags: undefined, y: 2, label: "l" })],
  ["y missing", () => ({ x: 1 })],
  ["y undefined", () => ({ x: 1, y: undefined })],
  ["y a string", () => ({ x: 1, y: "2" })],
  ["y not finite", () => ({ x: 1, y: Infinity })],
  ["label a number", () => ({ x: 1, y: 2, label: 3 })],
  ["tags hold a number", () => ({ x: 1, y: 2, tags: ["a", 1] })],
  ["one more key", () => ({ x: 1, y: 2, z: 3 })],
  ["one more key first", () => ({ z: 3, x: 1, y: 2 })],
  ["one more key between", () => ({ x: 1, z: { deep: [1] }, y: 2, label: "l" })],
  ["an index", () => ({ x: 1, y: 2, 0: "zero" })],
  ["a symbol", () => ({ x: 1, y: 2, [Symbol.for("s")]: 1 })],
  ["__proto__ as a key", () => JSON.parse('{"x":1,"y":2,"__proto__":{"label":"from above"}}')],
  ["a getter", withGetter],
  ["a hidden label", hidden],
  ["a read-only y", readOnly],
  ["frozen", () => Object.freeze({ x: 1, y: 2 })],
  ["sealed", () => Object.seal({ x: 1, y: 2, label: "l" })],
  ["not extensible", () => Object.preventExtensions({ x: 1, y: 2 })],
  ["no prototype", () => Object.assign(Object.create(null), { x: 1, y: 2 })],
  ["y from the prototype", () => Object.assign(Object.create({ y: 2 }), { x: 1 })],
  ["label from the prototype", () => Object.assign(Object.create({ label: "above" }), { x: 1, y: 2 })],
  ["an instance", () => new Pair()],
  ["a dictionary", dictionary],
  ["deleted and added again", () => { const o: Record<string, unknown> = { x: 1, y: 2, label: "l" }; delete o.x; o.x = 5; return o; }],
  ["an array", () => Object.assign([], { x: 1, y: 2 })],
  ["a function", () => Object.assign(() => {}, { x: 1, y: 2 })],
  ["a proxy", () => new Proxy({ x: 1, y: 2 }, {})],
  ["a Map", () => Object.assign(new Map(), { x: 1, y: 2 })],
  ["a getter in a literal", () => ({ x: 1, get y() { getterRuns++; return 2; } })],
  ["a setter alone in a literal", () => ({ x: 1, y: 2, set label(value: string) { getterRuns += 100; } })],
  ["a method in a literal", () => ({ x: 1, y: 2, label() { return "l"; } })],
  ["an instance with one more member", () => Object.assign(new Pair(), { label: "l" })],
  ["an instance with an accessor above", () => new (class extends Pair { get label() { getterRuns++; return "above"; } })()],
  ["a literal that grew", () => { const o: Record<string, unknown> = { x: 1 }; o.label = "l"; o.y = 2; return o; }],
  ["a literal that lost a member", () => { const o: Record<string, unknown> = { x: 1, y: 2, label: "l", z: 3 }; delete o.z; return o; }],
  ["a literal with a computed key", () => ({ x: 1, ["y"]: 2, ["la" + "bel"]: "l" })],
  ["a spread of a literal", () => ({ ...{ y: 2, x: 1 }, label: "l" })],
  ["a frozen literal with tags", () => Object.freeze({ x: 1, y: 2, tags: Object.freeze(["a"]) })],
  ["null", () => null],
  ["a validated point", () => validate<Point>({ y: 2, x: 1, label: "again" })],
];

for (let round = 0; round < 3; round++) {
  for (const [name, make] of pointSources) {
    const source = make();
    console.log(round, "Point", name, "->", tried(() => validate<Point>(source), source));
    const other = make();
    console.log(round, "StrictPoint", name, "->", tried(() => validate<StrictPoint>(other), other));
  }
}
console.log("getter runs", getterRuns);

// The copy is the program's own: what is done to it does not reach the source, and the other way round.
{
  const source = { x: 1, y: 2, tags: ["a"] };
  const copy = validate<Point>(source);
  copy.x = 10;
  copy.tags!.push("b");
  copy.label = "late";
  source.y = 20;
  console.log(describe(source), describe(copy), Object.keys(copy).join());
  delete (copy as Partial<Point>).y;
  (copy as Record<string, unknown>).extra = true;
  console.log(describe(copy), "y" in copy, JSON.stringify(copy));
}

const nestedSources: [string, () => unknown][] = [
  ["plain", () => ({ name: "n", at: { x: 1, y: 2 }, corners: [{ x: 1, y: 2 }, { y: 4, x: 3 }, { x: 5, y: 6, label: "c" }] })],
  ["orders mixed", () => ({ corners: [{ label: "c", y: 6, x: 5 }], at: { y: 2, x: 1 }, name: "n" })],
  ["three deep", () => ({ name: "a", at: { x: 0, y: 0 }, corners: [], next: { next: { corners: [], at: { y: 1, x: 1 }, name: "c" }, name: "b", at: { x: 0, y: 0 }, corners: [] } })],
  ["the last corner is wrong", () => ({ name: "n", at: { x: 1, y: 2 }, corners: [{ x: 1, y: 2 }, { x: 3, y: 4 }, { x: 5 }] })],
  ["a corner has one more key", () => ({ name: "n", at: { x: 1, y: 2 }, corners: [{ x: 1, y: 2, z: 3 }] })],
  ["a corner holds undefined", () => ({ name: "n", at: { x: 1, y: 2 }, corners: [{ x: 1, label: undefined, y: 2 }] })],
  ["one object twice", () => { const p = { x: 1, y: 2 }; return { name: "n", at: p, corners: [p, p] }; }],
];
for (let round = 0; round < 3; round++) {
  for (const [name, make] of nestedSources) {
    const source = make();
    console.log(round, "Nested", name, "->", tried(() => validate<Nested>(source), source));
  }
}
{
  const p = { x: 1, y: 2 };
  const twice = validate<Nested>({ name: "n", at: p, corners: [p, p] });
  console.log("copies of one object are", twice.at === twice.corners[0] ? "one" : "two", twice.corners[0] === twice.corners[1] ? "one" : "two");
}

for (let round = 0; round < 2; round++) {
  for (const source of [{}, { a: 1 }, { b: "b" }, { c: true, a: 1 }, { c: false, b: "", a: 0 }, { a: undefined }, { b: undefined, c: true }, { a: "1" }, { d: 1 }]) {
    console.log(round, "OnlyOptional", describe(source), "->", tried(() => validate<OnlyOptional>(source), source));
  }
  for (const source of [{ a: 1 }, { a: undefined }, {}, { b: 1 }, { a: undefined, b: undefined }, { b: 2, a: 1 }]) {
    console.log(round, "MayBeUndefined", describe(source), "->", tried(() => validate<MayBeUndefined>(source), source));
  }
  for (const source of [{ host: "h" }, { host: "h", port: 1 }, { port: 2, host: "h" }, { port: undefined, host: "h" }, { port: 3 }]) {
    console.log(round, "WithDefault", describe(source), "->", tried(() => validate<WithDefault>(source), source));
  }
}

// Members that do not fit into the object itself lie outside it.
for (let round = 0; round < 2; round++) {
  for (const count of [0, 1, 5, 6, 7, 8, 20, 63, 64, 70]) {
    const forwards: Record<string, number> = { id: count };
    for (let i = 0; i < count; i++) forwards["m" + String(i).padStart(2, "0")] = i;
    const backwards: Record<string, number> = {};
    for (let i = count - 1; i >= 0; i--) backwards["m" + String(i).padStart(2, "0")] = i;
    backwards.id = count;
    for (const source of [forwards, backwards, JSON.parse(JSON.stringify(forwards))]) {
      const result = validate<Wide>(source);
      let sum = result.id;
      for (const key of Object.keys(result)) sum += (result as Record<string, number>)[key];
      console.log(round, "Wide", count, Object.keys(result).length, Object.keys(result).join() === Object.keys(source).join(), sum, result.m00, result.m05, result.m06, result.m69);
    }
  }
}

// More shapes than anything remembers, shapes that die between collections, and the first shapes again afterwards.
{
  let taken = 0;
  let refusedCount = 0;
  for (let i = 0; i < 12000; i++) {
    const source: Record<string, unknown> = {};
    if (i & 1) source.y = i;
    source.x = i;
    if (!(i & 1)) source.y = i;
    source["extra" + i] = i;
    try {
      const copy = validate<Point>(source) as Record<string, unknown>;
      if (copy.x === i && copy.y === i && copy["extra" + i] === i && Object.keys(copy).join() === Object.keys(source).join()) taken++;
    } catch {
      refusedCount++;
    }
    try {
      validate<StrictPoint>(source);
      taken += 1000000;
    } catch {
      refusedCount++;
    }
    if (i % 3000 === 2999) Bun.gc(true);
  }
  console.log("many shapes", taken, refusedCount);
  for (const [name, make] of pointSources.slice(0, 8)) {
    const source = make();
    console.log("afterwards", name, "->", tried(() => validate<Point>(source), source));
  }
}
