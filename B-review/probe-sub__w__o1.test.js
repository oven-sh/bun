const test = require("node:test");
test("parent: subtest fails and after hook throws", async t => {
  t.after(() => { throw new Error("from the after hook"); });
  await t.test("child", () => { throw new Error("ROOT CAUSE in the child"); });
});
