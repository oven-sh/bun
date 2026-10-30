// A Map or Set declared with string keys meets keys that are no strings, receivers that are no plain maps, and methods that are reached in other ways.
declare const console: { log(...values: unknown[]): void };
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true));
function show(label: string, ...values: unknown[]): void {
  console.log(label, ...values.map(value => (typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? value.toString() : Object.is(value, -0) ? "-0" : value)));
}
function entries(map: any): string {
  const out: string[] = [];
  for (const [key, value] of map) out.push(typeof key + ":" + String(Object.is(key, -0) ? "-0" : key) + "=" + String(value));
  return out.join(" ");
}

// Keys through `any`.
{
  const map = new Map<string, number>();
  const loose: any = map;
  map.set("NaN", 1).set("0", 2).set("-0", 3).set("undefined", 4).set("null", 5).set("1", 6).set("true", 7);
  loose.set(NaN, 10);
  loose.set(0, 20);
  loose.set(-0, 30);
  loose.set(undefined, 40);
  loose.set(null, 50);
  loose.set(1, 60);
  loose.set(true, 70);
  loose.set(1.5, 80);
  loose.set(10n, 90);
  loose.set(2 ** 40, 100);
  show("mixed", entries(map), map.size);
  show("by text", map.get("NaN"), map.get("0"), map.get("-0"), map.get("undefined"), map.get("null"), map.get("1"), map.get("true"));
  show("by value", loose.get(NaN), loose.get(0 / 0), loose.get(0), loose.get(-0), loose.get(undefined), loose.get(null), loose.get(1), loose.get(1.0), loose.get(true), loose.get(1.5), loose.get(10n), loose.get(BigInt(10)), loose.get(2 ** 40));
  show("has", loose.has(NaN), loose.has(-0), loose.has(2), loose.has("2"), loose.has(false), loose.has(11n));
  show("delete", loose.delete(NaN), loose.delete(NaN), loose.delete(-0), loose.delete(0), map.delete("0"), map.size);
  show("left", entries(map));
}
{
  const map = new Map<string, string>();
  const loose: any = map;
  loose.set(-0, "zero");
  for (const key of loose.keys()) show("minus zero is kept as", key, typeof key);
  const set = new Set<string>();
  (set as any).add(-0);
  (set as any).add(NaN);
  (set as any).add(NaN);
  for (const key of set as any) show("in the set", key, typeof key);
  show("size", set.size, (set as any).has(0), (set as any).has(NaN), set.has("0"), set.has("NaN"));
}
{
  const object = {};
  const symbol = Symbol("key");
  const map = new Map<string, number>([["a", 1], ["b", 2]]);
  const loose: any = map;
  loose.set(object, 3);
  loose.set(symbol, 4);
  loose.set([1], 5);
  show("objects", loose.get(object), loose.get({}), loose.get(symbol), loose.get(Symbol("key")), loose.get([1]), map.get("a"), map.get("[object Object]"), map.get("1"), map.size);
}

// A key that may be undefined or null by its type.
function lookUp(map: Map<string, number>, key: string | undefined | null): number | undefined {
  return map.get(key as string);
}
{
  const map = new Map<string, number>([["undefined", 1], ["null", 2], ["", 3]]);
  show("absent keys", lookUp(map, undefined), lookUp(map, null), lookUp(map, ""), lookUp(map, "undefined"), map.has(undefined as any), map.has(null as any));
  (map as any).set(undefined, 4);
  (map as any).set(null, 5);
  show("present keys", lookUp(map, undefined), lookUp(map, null), lookUp(map, ""), lookUp(map, "null"), map.size);
}

// Values of every kind, and a table that has to change how it keeps them.
{
  const map = new Map<string, unknown>();
  const item = { n: 1 };
  map.set("object", item).set("undefined", undefined).set("null", null).set("true", true).set("false", false);
  show("narrow", map.get("object") === item, map.get("undefined"), map.has("undefined"), map.get("null"), map.get("true"), map.get("false"), map.get("none"), map.has("none"));
  map.set("int", 7).set("double", 1.5).set("minus zero", -0).set("nan", NaN).set("text", "t").set("bigint", 5n).set("symbol", Symbol.iterator).set("big", 2 ** 53);
  show("wide", map.get("object") === item, map.get("undefined"), map.get("null"), map.get("true"), map.get("false"), map.get("int"), map.get("double"), map.get("minus zero"), map.get("nan"), map.get("text"), map.get("bigint"), map.get("symbol"), map.get("big"));
  map.set("object", 0).set("true", "yes");
  show("overwritten", map.get("object"), map.get("true"), [...map.keys()].join());
  const first = new Map<string, unknown>();
  first.set("n", 1);
  first.set("o", item);
  show("a number first", first.get("n"), first.get("o") === item);
}

// Subclasses, own properties, and methods reached in other ways.
class Counting extends Map<string, number> {
  reads = 0;
  override get(key: string): number | undefined {
    this.reads++;
    return super.get(key.toLowerCase());
  }
}
class Plain extends Map<string, number> {}
class Shouting extends Set<string> {
  override has(key: string): boolean {
    return super.has(key.toUpperCase());
  }
  override add(key: string): this {
    return super.add(key.toUpperCase());
  }
}
function read(map: Map<string, number>, key: string): number | undefined {
  return map.get(key);
}
function readInLoop(map: Map<string, number>, keys: string[]): string {
  let out = "";
  for (const key of keys) out += map.get(key) + ",";
  return out;
}
function write(map: Map<string, number>, key: string, value: number): Map<string, number> {
  return map.set(key, value);
}
{
  const plain = new Map<string, number>([["a", 1]]);
  const counting = new Counting([["a", 2]]);
  const derived = new Plain([["a", 3]]);
  const own = new Map<string, number>([["a", 4]]);
  (own as any).get = function (key: string) {
    return key.length;
  };
  const later = new Map<string, number>([["a", 5]]);
  for (const map of [plain, counting, derived, own, later, plain]) show("read", read(map, "a"), read(map, "A"), readInLoop(map, ["a", "A", "b"]));
  show("reads", counting.reads);
  (later as any).extra = 1;
  show("with a property", read(later, "a"), readInLoop(later, ["a"]), write(later, "b", 6) === later, later.size);
  Object.setPrototypeOf(later, Counting.prototype);
  show("with another prototype", read(later, "A"), readInLoop(later, ["A", "B"]));
  const shouting = new Shouting(["a"]);
  const asSet: Set<string> = shouting;
  show("set", asSet.has("a"), asSet.has("A"), [...asSet.add("b")].join());
  show("frozen", read(Object.freeze(new Map<string, number>([["a", 7]])), "a"), write(Object.freeze(new Map<string, number>()), "k", 1).size);
}
{
  const map = new Map<string, number>([["a", 1]]);
  const loose: any = map;
  const get = map.get;
  const name = "get";
  show("other ways", loose.get("a"), loose[name]("a"), get.call(map, "a"), Map.prototype.get.call(map, "a"), Reflect.apply(Map.prototype.get, map, ["a"]), map.get.bind(map)("a"), map["get"]("a"));
  for (const receiver of [new Set(["a"]), {}, null, undefined, "a", new WeakMap(), Object.create(Map.prototype)]) {
    try {
      show("no map", Map.prototype.get.call(receiver as any, "a"));
    } catch (error) {
      show("no map", (error as Error).constructor.name);
    }
    try {
      show("no set", Set.prototype.has.call(receiver as any, "a"));
    } catch (error) {
      show("no set", (error as Error).constructor.name);
    }
  }
  try {
    show("nil", read(null as any, "a"));
  } catch (error) {
    show("nil", (error as Error).constructor.name);
  }
  show("more and fewer arguments", (loose.get as Function)("a", "b"), (loose.get as Function)(), (loose.has as Function)(), (loose.set as Function)("only").get("only"), loose.has("only"), (loose.set as Function)().has(undefined), map.size);
}

// With frozen prototypes. Object.freeze succeeds in a compiled program too: it only tightens what is fixed from the start. Nothing is printed unless it throws.
try {
  Object.freeze(Map.prototype);
} catch (error) {
  show("freeze Map.prototype", (error as Error).constructor.name);
}
try {
  Object.freeze(Set.prototype);
} catch (error) {
  show("freeze Set.prototype", (error as Error).constructor.name);
}
{
  const map = new Map<string, number>();
  for (let i = 0; i < 20; i++) map.set("k" + i, i);
  let total = 0;
  for (let i = 0; i < 25; i++) total += map.get("k" + i) ?? -1;
  show("frozen prototypes", total, map.size, new Set<string>(map.keys()).has("k7"));
}
collect();
