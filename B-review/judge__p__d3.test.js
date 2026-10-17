const { test } = require("node:test");
test("xfail test whose only failure is a failed subtest", { expectFailure: true }, async t => {
  // The subtest inherits expectFailure, passes its body, and so fails.
  await t.test("child passes its body", () => {});
});
