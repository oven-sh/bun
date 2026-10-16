const assert = require("node:assert");
class BrokenURL extends URL { get href() { throw new Error("href"); } }
class BrokenName { static get name() { throw new Error("name"); } }
const triggers = {
  toStringTag: () => assert.deepStrictEqual({ a: { get [Symbol.toStringTag]() { throw new Error("tag"); } } }, { a: 1 }),
  message: () => assert.strictEqual(1, 2, { toString() { throw new Error("toString"); } }),
  hrefOfURL: () => assert.deepStrictEqual({ a: new BrokenURL("http://example.com/a") }, { a: 1 }),
  staticName: () => assert.deepStrictEqual({ a: new BrokenName() }, { a: 1 }),
};
const rows = {};
for (const name in triggers) {
  Error.stackTraceLimit = 10;
  let threw = false;
  const t0 = performance.now();
  try { triggers[name](); } catch { threw = true; }
  rows[name] = { threw, limit: Error.stackTraceLimit, frames: String(new Error("later").stack).includes("\n    at "), ms: Math.round(performance.now() - t0) };
}
Object.defineProperty(Error, "stackTraceLimit", { value: 10, writable: false });
try { assert.strictEqual(1, 2); } catch (e) { rows.notWritable = e.name; }
console.log(JSON.stringify(rows, null, 1));
