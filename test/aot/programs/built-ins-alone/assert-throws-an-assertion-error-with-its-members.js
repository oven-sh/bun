import assert from "node:assert";
try {
  assert.strictEqual(1.5, "1.5");
} catch (error) {
  console.log(error instanceof assert.AssertionError, error.code, error.actual + 1, error.expected.length, error.operator);
}
assert.deepStrictEqual({ a: [1.5] }, { a: [1.5] });
assert.throws(() => {
  throw new RangeError();
}, RangeError);
console.log("passed");
