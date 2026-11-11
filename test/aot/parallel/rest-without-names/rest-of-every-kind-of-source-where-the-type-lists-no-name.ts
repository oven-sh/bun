// The rest of a pattern whose type lists no name, off every kind of source, and all that can be seen of it.
function without<T extends { a?: unknown }>({ a, ...rest }: T) {
  return rest;
}
function withoutTwo<T extends { a?: unknown; b?: unknown }>({ a, b, ...rest }: T) {
  return rest;
}
function withoutComputed<T extends object>(source: T, key: PropertyKey) {
  const { [key as keyof T]: left, ...rest } = source;
  return [left, rest];
}
function describe(object: object): string {
  const names = Reflect.ownKeys(object).map(key => {
    const found = Object.getOwnPropertyDescriptor(object, key)!;
    const flags = (found.writable ? "w" : "-") + (found.enumerable ? "e" : "-") + (found.configurable ? "c" : "-");
    return `${String(key)}:${flags}:${"value" in found ? JSON.stringify(found.value) : "accessor"}`;
  });
  const above = Object.getPrototypeOf(object);
  return `[${names.join(" ")}] above=${above === Object.prototype ? "Object.prototype" : above === null ? "null" : "other"} json=${JSON.stringify(object)} keys=${Object.keys(object).join(",")} extensible=${Object.isExtensible(object)}`;
}
const log: string[] = [];
const mark = Symbol("mark");
class Point {
  a = 1;
  x = 2;
  y = 3;
  get sum() {
    return this.x + this.y;
  }
}
const withGetter = {
  get a() {
    log.push("get a");
    return 1;
  },
  get b() {
    log.push("get b");
    return 2;
  },
  c: 3,
};
const hidden = { a: 1, b: 2 };
Object.defineProperty(hidden, "secret", { value: 4, enumerable: false });
Object.defineProperty(hidden, "fixed", { value: 5, enumerable: true, writable: false, configurable: false });
const traps: string[] = [];
const proxy = new Proxy(
  { a: 1, b: 2, c: 3 },
  {
    ownKeys(target) {
      traps.push("ownKeys");
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      traps.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get(target, key, receiver) {
      traps.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
  },
);
const bare = Object.create(null);
bare.a = 1;
bare.z = 26;
const deleted: { a?: number; b?: number; c: number; d?: number } = { a: 1, b: 2, c: 3 };
delete deleted.b;
deleted.d = 4;
deleted.b = 5;
const sources: [string, () => object][] = [
  ["a literal", () => ({ a: 1, b: 2, c: 3 })],
  ["a literal that lacks the key", () => ({ b: 2, c: 3 })],
  ["a literal with the key last", () => ({ b: 2, c: 3, a: 1 })],
  ["the key alone", () => ({ a: 1 })],
  ["nothing", () => ({})],
  ["out of a parser", () => JSON.parse('{"z":1,"a":2,"y":3,"10":4,"2":5}')],
  ["an instance", () => new Point()],
  ["a symbol", () => ({ a: 1, [mark]: 2, b: 3 })],
  ["indices", () => ({ b: 1, 2: "two", a: 0, 1: "one" })],
  ["not enumerable, not writable", () => hidden],
  ["frozen", () => Object.freeze({ a: 1, b: 2 })],
  ["below null", () => bare],
  ["a list", () => ["x", "y"]],
  ["a function", () => Object.assign(function named() {}, { a: 1, extra: 2 })],
  ["deleted and added again", () => deleted],
  ["__proto__ as its own", () => JSON.parse('{"a":1,"__proto__":{"inherited":true},"b":2}')],
  ["inherited", () => Object.create({ a: 1, inherited: 2 }, { own: { value: 3, enumerable: true } })],
];
for (const [name, make] of sources) {
  console.log(name, "|", describe(without(make() as { a?: unknown })));
  console.log(name, "| two |", describe(withoutTwo(make() as { a?: unknown })));
}
console.log("getters |", describe(without(withGetter)), "|", log.join(","));
log.length = 0;
console.log("getters | two |", describe(withoutTwo(withGetter)), "|", log.join(","));
console.log("a proxy |", describe(without(proxy)), "|", traps.join(","));
traps.length = 0;
console.log("a text |", describe(without("hey" as unknown as { a?: unknown })));
console.log("a number |", describe(without(5 as unknown as { a?: unknown })));
for (const key of ["b", "missing", mark, 1, "1"]) {
  const [left, rest] = withoutComputed({ a: 1, b: 2, [mark]: 3, 1: "one" }, key);
  console.log("computed", String(key), "|", JSON.stringify(left), "|", describe(rest as object));
}
for (const nothing of [undefined, null]) {
  try {
    without(nothing as unknown as { a?: unknown });
  } catch (error) {
    console.log("thrown |", (error as Error).constructor.name);
  }
}
// The copy is its own object, and takes what any object takes.
const source = { a: 1, b: { deep: true }, c: 3 };
const copy = without(source) as Record<string, unknown>;
copy.c = 4;
copy.added = 5;
delete copy.b;
copy.a = "back";
console.log("its own |", describe(copy), "|", describe(source));
let sum = 0;
for (let turn = 0; turn < 20000; turn++) {
  const rest = without(turn & 1 ? { a: turn, b: turn, c: 1 } : { kind: "k", a: turn, b: 2, d: turn }) as { b: number };
  sum += rest.b + Object.keys(rest).length;
}
console.log("in a loop |", sum);
