// util.inspect and console.log on values that need special care: collections, cycles, classes, symbols, accessors, proxies, typed arrays, boxed primitives, objects without a prototype, promises, errors with causes, options for depth, width and order, and a custom inspect method.
import util, { inspect } from "node:util";

class Point { constructor() { this.x = 1; } get double() { return 2; } static origin = 0; }
const cycle = { name: "cycle" };
cycle.self = cycle;
const values = [
  new Map([["a", { b: 1 }], [{ key: 1 }, new Set([1, "two"])]]),
  cycle,
  new Point(),
  Point,
  class extends Point {},
  { [Symbol("s")]: Symbol.iterator, "needs quotes": 1, valid_name: 2, 3: 4 },
  { get only() { return 1; }, set only2(v) {}, get both() { return 1; }, set both(v) {} },
  new Proxy({ target: 1 }, {}),
  new Uint8Array([1, 2, 3]),
  new Float64Array(2),
  new ArrayBuffer(2),
  [new Number(1), new String("s"), new Boolean(false), Object(Symbol("boxed")), Object(1n)],
  Object.create(null),
  Object.assign(Object.create(null), { a: 1 }),
  [Promise.resolve(1), new Promise(() => {})],
  [, 1, , , 2],
  Object.assign([1, 2], { extra: true }),
  [function named() {}, () => {}, async function later() {}, function* gen() {}, Math.max],
  [-0, 0, NaN, 1e21, 123456789n, "it's", 'say "hi"', `both ' and "`],
  [new Date(0), /re/gi, new WeakMap(), new WeakSet()],
  [null, undefined, true],
  { a: { b: { c: { d: { e: 1 } } } } },
  "x".repeat(20),
  { [inspect.custom]() { return "custom text"; } },
  { [inspect.custom](depth, options) { return { depth, hasStylize: typeof options.stylize }; } },
  Object.assign(() => {}, { property: 1 }),
  (function () { return arguments; })(1, 2),
  new (class Empty {})(),
  new (class extends Map {})([[1, 2]]),
  { toString() { return "not used"; } },
];
for (const value of values) console.log(inspect(value));
console.log(inspect({ a: { b: { c: {} } } }, { depth: 0 }), inspect({ a: { b: { c: {} } } }, { depth: null }));
console.log(inspect({ b: 1, a: 2 }, { sorted: true }), inspect({ a: 1, b: [1, 2] }, { compact: false }));
console.log(inspect("a".repeat(5) + "\n" + "b", { breakLength: 3 }), inspect(Array.from({ length: 120 }, (_, i) => i), { maxArrayLength: 3 }));
console.log(inspect(new Proxy({ a: 1 }, {}), { showProxy: true }), inspect({ a: 1 }, { colors: true }), inspect("long string", { maxStringLength: 4 }));
console.log(inspect({ hidden: 1 }, { showHidden: true }), inspect([1], { showHidden: true }), inspect({ get a() { return 5; } }, { getters: true }));
const error = new RangeError("outer", { cause: new TypeError("inner") });
console.log(inspect(error).split("\n").filter(line => !line.trim().startsWith("at ")).join("|"));
console.log(util.format("%s %d %i %f %j %o %O %% %c", "s", "4.5", "4.5", "4.5", { j: 1 }, [1], { O: 1 }, "css"), util.format("extra", 1, { a: 1 }), util.format("%s", { toString() { return "own"; } }));
