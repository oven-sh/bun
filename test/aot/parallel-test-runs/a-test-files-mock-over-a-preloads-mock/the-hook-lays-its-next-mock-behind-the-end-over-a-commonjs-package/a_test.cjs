// Under `bun test` the mock of the hook that the mock in the test displaced is added again at the end of this file, over the ones that the hook laid later.
const { test, vi } = require("bun:test");
const name = "made-up-pack/lib.cjs";
const ask = () => require(name).who;
test("one", () => {
  console.log("SAID in the test", ask());
  vi.doMock(name, () => ({ who: "of the test" }));
  console.log("SAID under it", ask());
  vi.doUnmock(name);
  console.log("SAID behind its end", ask());
});
test("two", () => {});
