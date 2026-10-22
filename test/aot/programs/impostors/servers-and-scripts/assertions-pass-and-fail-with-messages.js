import assert, { AssertionError } from "node:assert";
import strict from "node:assert/strict";

assert(true);
assert.ok(1, "one is truthy");
assert.equal(1, "1");
assert.strictEqual("a", "a");
assert.deepEqual({ a: [1, 2] }, { a: [1, 2] });
assert.deepStrictEqual(new Map([["k", { v: 1 }]]), new Map([["k", { v: 1 }]]));
assert.notDeepStrictEqual([1], ["1"]);
assert.match("abc", /b/);
assert.throws(() => JSON.parse("{"), SyntaxError);
assert.throws(() => { throw new RangeError("too big"); }, { name: "RangeError", message: "too big" });
assert.doesNotThrow(() => 1);
await assert.rejects(Promise.reject(new TypeError("no")), TypeError);
await assert.doesNotReject(Promise.resolve(1));

function failure(run) {
  try {
    run();
    return "did not fail";
  } catch (error) {
    return [error instanceof AssertionError, error.name, error.code, error.operator, error.generatedMessage, JSON.stringify(error.actual), JSON.stringify(error.expected), error.message.split("\n")[0]].join(" | ");
  }
}
console.log(failure(() => assert.strictEqual(1, 2)));
console.log(failure(() => assert.strictEqual(1, 2, "my own message")));
console.log(failure(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })));
console.log(failure(() => assert.ok(0)));
console.log(failure(() => assert.equal(null, 0)));
console.log(failure(() => assert.notStrictEqual("x", "x")));
console.log(failure(() => assert.throws(() => {})));
console.log(failure(() => assert.fail("stop here")));
console.log(failure(() => assert.ifError(new Error("an error came back"))));
console.log(failure(() => strict.equal(1, "1")));
console.log(failure(() => assert.match("abc", /x/)));
console.log(failure(() => assert.strictEqual(NaN, NaN)), failure(() => assert.deepStrictEqual(-0, 0)).split(" | ")[2]);
console.log(await assert.rejects(Promise.resolve(1)).catch(error => error.code), strict.strictEqual === assert.strictEqual, typeof assert.CallTracker);
const custom = new AssertionError({ actual: 1, expected: 2, operator: "strictEqual" });
console.log(custom.message.split("\n").length > 1, Object.keys(custom).sort().join());
