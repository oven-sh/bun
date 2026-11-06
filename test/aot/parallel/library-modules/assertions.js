// node:assert and node:assert/strict: what passes, what throws, the code, the operator and the first line of the message of an AssertionError, throws and rejects with every kind of expectation, deep equality of collections, match, ifError and fail.
import assert, { AssertionError } from "node:assert";
import strict from "node:assert/strict";

function tell(label, run) {
  try {
    run();
    console.log(label, "passes");
  } catch (error) {
    console.log(label, error.name, error.code, error.operator, JSON.stringify(String(error.message).split("\n")[0]), error.generatedMessage);
  }
}
tell("ok", () => assert(1));
tell("ok of 0", () => assert.ok(0));
tell("own message", () => assert(false, "my own words"));
tell("equal", () => assert.equal(1, "1"));
tell("strictEqual", () => assert.strictEqual(1, "1"));
tell("notStrictEqual", () => assert.notStrictEqual(1, 1));
tell("deepEqual", () => assert.deepEqual({ a: [1, "2"] }, { a: ["1", 2] }));
tell("deepStrictEqual", () => assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 2] }));
tell("deepStrictEqual fails", () => assert.deepStrictEqual({ a: 1 }, { a: 2 }));
tell("maps and sets", () => assert.deepStrictEqual(new Map([[1, new Set([2])]]), new Map([[1, new Set([2])]])));
tell("prototypes", () => assert.deepStrictEqual(new (class A {})(), {}));
tell("NaN and zeros", () => { assert.deepStrictEqual(NaN, NaN); assert.deepStrictEqual(0, -0); });
tell("throws", () => assert.throws(() => { throw new TypeError("bad"); }, TypeError));
tell("throws a pattern", () => assert.throws(() => { throw new Error("bad thing"); }, /thing/));
tell("throws an object", () => assert.throws(() => { throw new RangeError("r"); }, { name: "RangeError", message: "r" }));
tell("throws nothing", () => assert.throws(() => {}));
tell("throws another", () => assert.throws(() => { throw new TypeError("bad"); }, RangeError));
tell("doesNotThrow", () => assert.doesNotThrow(() => { throw new Error("did"); }));
tell("match", () => assert.match("abc", /x/));
tell("doesNotMatch", () => assert.doesNotMatch("abc", /x/));
tell("ifError of null", () => assert.ifError(null));
tell("ifError", () => assert.ifError(new Error("given")));
tell("fail", () => assert.fail("failed on purpose"));
tell("strict.equal", () => strict.equal(1, "1"));
tell("an error as the message", () => assert(false, new SyntaxError("thrown as it is")));
console.log(await assert.rejects(Promise.reject(new Error("no")), /no/), await assert.rejects(Promise.resolve(1)).catch(error => error.code), await assert.doesNotReject(Promise.resolve(1)));
const made = new AssertionError({ actual: 1, expected: 2, operator: "strictEqual" });
console.log(made instanceof Error, made.actual, made.expected, made.code, strict.strict === strict, assert.strict === strict, assert.AssertionError === AssertionError);
