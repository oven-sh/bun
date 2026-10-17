const test = require("node:test");
const assert = require("node:assert");

// Candidate rows for fixtures/35-context-error.js, in the style of that fixture.
function outcomes(t) {
  const seen = new Map();
  t.afterEach(ctx => {
    seen.set(ctx.name, { passed: ctx.passed, error: ctx.error });
  });
  return seen;
}

const todo = { todo: true };

test("a plan that times out is a testTimeoutFailure", async t => {
  const seen = outcomes(t);
  await t.test("plan timeout", todo, st => {
    st.plan(1, { wait: 5 });
  });
  const message = "plan timed out after 5ms with 0 assertions when expecting 1";
  const { passed, error } = seen.get("plan timeout");
  assert.strictEqual(passed, false);
  assert.strictEqual(error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(error.failureType, "testTimeoutFailure");
  assert.strictEqual(error.message, message);
  assert.strictEqual(error.cause, message);
});

test("a failed before hook is hookFailed for the subtest and testCodeFailure for the test that owns the hook", async t => {
  const seen = outcomes(t);
  const fromBefore = new Error("from before");
  let child;
  let bodyRan = false;
  await t.test("owner", todo, async st => {
    st.afterEach(ctx => {
      child = { passed: ctx.passed, error: ctx.error };
    });
    st.before(() => {
      throw fromBefore;
    });
    await st.test("child", todo, () => {
      bodyRan = true;
    });
  });
  assert.strictEqual(bodyRan, false);
  assert.strictEqual(child.passed, false);
  assert.strictEqual(child.error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(child.error.failureType, "hookFailed");
  assert.strictEqual(child.error.message, "failed running before hook");
  assert.strictEqual(child.error.cause, fromBefore);
  const owner = seen.get("owner");
  assert.strictEqual(owner.passed, false);
  assert.strictEqual(owner.error.failureType, "testCodeFailure");
  assert.strictEqual(owner.error.message, "from before");
  assert.strictEqual(owner.error.cause, fromBefore);
});

test("a failed after hook is hookFailed", async t => {
  const fromAfter = new Error("from after");
  let ctx;
  await t.test("after throws", todo, st => {
    ctx = st;
    st.after(() => {
      throw fromAfter;
    });
  });
  assert.strictEqual(ctx.passed, false);
  assert.strictEqual(ctx.error.code, "ERR_TEST_FAILURE");
  assert.strictEqual(ctx.error.failureType, "hookFailed");
  assert.strictEqual(ctx.error.message, "failed running after hook");
  assert.strictEqual(ctx.error.cause, fromAfter);
});

test("a hook that times out is hookFailed, and its cause is the message of the timeout", async t => {
  const seen = outcomes(t);
  t.beforeEach(() => new Promise(() => {}), { timeout: 5 });
  await t.test("child", todo, () => {});
  const { passed, error } = seen.get("child");
  assert.strictEqual(passed, false);
  assert.strictEqual(error.failureType, "hookFailed");
  assert.strictEqual(error.message, "failed running beforeEach hook");
  assert.strictEqual(error.cause, "test timed out after 5ms");
});
