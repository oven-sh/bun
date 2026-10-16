const assert = require("node:assert");
const before = 10;
class Broken { get href() { throw new Error("boom"); } }
class Link { get href() { return "http://example.com/a"; } }
class NameThrows { static get name() { throw new Error("static name"); } }
class StackThrows extends Error { get stack() { throw new Error("stack getter"); } }
class MyURL extends URL {}
const nullProtoHref = Object.create(null, { href: { get() { throw new Error("null-proto href"); } } });
const cases = {
  "Q1 deepStrictEqual nested Broken": () => assert.deepStrictEqual({ a: new Broken() }, { a: 1 }),
  "Q1 strictEqual Broken": () => assert.strictEqual(new Broken(), 1),
  "Q1 deepStrictEqual Object.create(URL.prototype)": () => assert.deepStrictEqual({ a: Object.create(URL.prototype) }, { a: 1 }),
  "Q1 deepStrictEqual MyURL.prototype": () => assert.deepStrictEqual(MyURL.prototype, { a: 1 }),
  "Q1 deepStrictEqual null-proto with href getter": () => assert.deepStrictEqual(nullProtoHref, { a: 1 }),
  "Q1 notStrictEqual Broken": () => { const b = new Broken(); assert.notStrictEqual(b, b); },
  "Q1 notDeepStrictEqual Broken": () => { const b = new Broken(); assert.notDeepStrictEqual(b, b); },
  "Q1 deepEqual Broken": () => assert.deepEqual(new Broken(), 1),
  "Q1 equal Broken": () => assert.equal(new Broken(), 1),
  "Q1 partialDeepStrictEqual Broken": () => assert.partialDeepStrictEqual({ a: new Broken() }, { a: 1 }),
  "Q1 throws validation object": () => assert.throws(() => { throw Object.assign(new Error("x"), { v: new Broken() }); }, { v: 1 }),
  "Q1 strictEqual with custom message": () => assert.strictEqual(new Broken(), 1, "custom"),
  "Q1 ok(false, msg) (no inspect)": () => assert.ok(false, "plain"),
  "Q1 non-throwing href getter (Link)": () => assert.deepStrictEqual({ a: new Link() }, { a: 1 }),
  "other: Symbol.toStringTag getter throws (nested)": () => assert.deepStrictEqual({ a: { get [Symbol.toStringTag]() { throw new Error("tag"); } } }, { a: 1 }),
  "other: Symbol.toStringTag getter throws (top)": () => assert.deepStrictEqual({ get [Symbol.toStringTag]() { throw new Error("tag"); } }, { a: 1 }),
  "other: static name getter throws": () => assert.deepStrictEqual({ a: new NameThrows() }, { a: 1 }),
  "other: Error subclass stack getter throws": () => assert.deepStrictEqual({ a: new StackThrows("x") }, { a: 1 }),
  "other: message.toString throws": () => assert.strictEqual(1, 2, { toString() { throw new Error("toString"); } }),
  "other: own getter throws (getters: true)": () => assert.deepStrictEqual({ get a() { throw new Error("own getter"); } }, { a: 1 }),
  "other: new AssertionError direct, throwing href": () => new assert.AssertionError({ actual: new Broken(), expected: 1, operator: "strictEqual" }),
  "other: new AssertionError({message: obj w/ throwing toString})": () => new assert.AssertionError({ message: { toString() { throw new Error("toString2"); } } }),
};
let leaks = 0, n = 0, notAssertion = 0;
for (const [name, f] of Object.entries(cases)) {
  Error.stackTraceLimit = before;
  let thrown;
  try { f(); } catch (e) { thrown = e; }
  const after = Error.stackTraceLimit;
  Error.stackTraceLimit = before;
  n++; if (after !== before) leaks++;
  const what = thrown === undefined ? "no throw" : `${thrown && thrown.name}: ${String(thrown && thrown.message).split("\n")[0].slice(0, 70)}`;
  if (process.argv[2] !== "count") console.log(`${after === before ? "restored" : "LEAK->" + after} | ${name} | ${what}`);
}
console.log("LEAK rows: " + leaks + " of " + n);
