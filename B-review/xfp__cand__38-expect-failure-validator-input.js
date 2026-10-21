const test = require("node:test");
const assert = require("node:assert");

// What the validator of expectFailure receives. Test code that threw a truthy
// value: that value. Any other failure: the ERR_TEST_FAILURE error. A plan
// mismatch is a testCodeFailure whose cause is its message, so it is a string.
const kMismatch = "The test failed, but the error did not match the expected validation";

function outcomes(t) {
  const seen = new Map();
  t.afterEach(ctx => {
    seen.set(ctx.name, { passed: ctx.passed, message: ctx.error && ctx.error.message });
  });
  return seen;
}

test("a plan mismatch is validated as its message string", async t => {
  const seen = outcomes(t);
  const body = st => {
    st.plan(2);
  };
  await t.test("object", { todo: true, expectFailure: { message: /plan expected/ } }, body);
  await t.test("function", { todo: true, expectFailure: e => e === "plan expected 2 assertions but received 0" }, body);
  await t.test("anchored RegExp", { todo: true, expectFailure: /^plan expected/ }, body);
  assert.deepStrictEqual(seen.get("object"), { passed: false, message: kMismatch });
  assert.strictEqual(seen.get("function").passed, true);
  assert.strictEqual(seen.get("anchored RegExp").passed, true);
});

test("a hook failure is validated as the hookFailed error, not as the value that the hook threw", async t => {
  const seen = outcomes(t);
  t.beforeEach(() => {
    throw new TypeError("from beforeEach");
  });
  await t.test("RegExp for the hook's message", { todo: true, expectFailure: /from beforeEach/ }, () => {});
  await t.test("class of the hook's error", { todo: true, expectFailure: TypeError }, () => {});
  await t.test(
    "object for the hookFailed error",
    { todo: true, expectFailure: { failureType: "hookFailed", message: "failed running beforeEach hook" } },
    () => {},
  );
  assert.deepStrictEqual(seen.get("RegExp for the hook's message"), { passed: false, message: kMismatch });
  assert.deepStrictEqual(seen.get("class of the hook's error"), { passed: false, message: kMismatch });
  assert.strictEqual(seen.get("object for the hookFailed error").passed, true);
});

test("a timeout is validated as the testTimeoutFailure error", async t => {
  const seen = outcomes(t);
  const never = () => new Promise(() => {});
  await t.test("failureType", { todo: true, timeout: 5, expectFailure: { failureType: "testTimeoutFailure" } }, never);
  await t.test("String(error)", { todo: true, timeout: 5, expectFailure: /^Error \[ERR_TEST_FAILURE\]: test timed out/ }, never);
  assert.strictEqual(seen.get("failureType").passed, true);
  assert.strictEqual(seen.get("String(error)").passed, true);
});

test("a falsy thrown value is validated as the error, and the value is its cause", async t => {
  const seen = outcomes(t);
  const body = () => {
    throw 0;
  };
  await t.test("the value", { todo: true, expectFailure: e => e === 0 }, body);
  await t.test("the error", { todo: true, expectFailure: e => e.code === "ERR_TEST_FAILURE" && e.cause === 0 }, body);
  assert.deepStrictEqual(seen.get("the value"), { passed: false, message: kMismatch });
  assert.strictEqual(seen.get("the error").passed, true);
});
