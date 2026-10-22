// usage: <runtime> bench.js <relation> <kind> <count>
const assert = require("node:assert");
const util = require("node:util");
const [relation, kind, count] = [process.argv[2], process.argv[3], Number(process.argv[4])];
class Point { constructor() { this.foo = "123"; this.bar = "baz"; } }
const kinds = {
  same: () => ({ foo: "123", bar: "baz" }),
  mixed: i => (i ? { bar: "baz", foo: "123" } : { foo: "123", bar: "baz" }),
  inst: i => (i ? { foo: "123", bar: "baz" } : new Point()),
  cls: () => new Point(),
  nullproto: i => (i ? { foo: "123", bar: "baz" } : Object.assign(Object.create(null), { foo: "123", bar: "baz" })),
  arr3: () => [1, 2, 3],
  arrobj: () => [{ a: 1 }, { b: 2 }, { c: 3 }],
  idx: () => ({ 0: "a", 1: "b", x: 1 }),
  getter: () => ({ get g() { return 1; }, x: 1 }),
  err: () => new Error("message"),
  nested: () => ({ a: { b: { c: [1, { d: "e" }] } }, f: [{ g: 1 }, { h: 2 }] }),
  date: () => new Date(0),
  u8: () => new Uint8Array([1, 2, 3, 4]),
  re: () => /a+b/g,
  num: () => new Number(1),
  map: () => new Map([[1, 1], [2, 2], [3, 3]]),
  set: () => new Set([1, 2, 3]),
  setobj: () => new Set([{ a: 1 }, { a: 2 }]),
  mapobj: () => new Map([[{ a: 1 }, 1], [{ a: 2 }, 2]]),
};
const a = kinds[kind](0), b = kinds[kind](1);
const relations = {
  "assert.deepEqual": () => assert.deepEqual(a, b),
  "assert.deepStrictEqual": () => assert.deepStrictEqual(a, b),
  "util.isDeepStrictEqual": () => util.isDeepStrictEqual(a, b),
  "Bun.deepEquals": () => Bun.deepEquals(a, b),
  "Bun.deepEquals.strict": () => Bun.deepEquals(a, b, true),
  noop: () => {},
};
if (relation === "expect.toEqual") { const { expect } = require("bun:test"); relations[relation] = () => expect(a).toEqual(b); }
const run = relations[relation];
for (let i = 0; i < count; i++) run();
