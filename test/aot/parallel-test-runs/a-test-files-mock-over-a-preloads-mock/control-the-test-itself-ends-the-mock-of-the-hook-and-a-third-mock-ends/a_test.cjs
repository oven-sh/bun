// No mock of the test file has displaced the mock of the hook: the test has ended it. What the first mock of the file had set aside still lies there, and the end of the third brings that back.
const { test, vi } = require("bun:test");
const name = "made-up-pack/lib.cjs";
const ask = () => require(name).who;
console.log("SAID at first", ask());
vi.doMock(name, () => ({ who: "of the file" }));
test("one", () => {
  vi.doUnmock(name);
  vi.doMock(name, () => ({ who: "the third" }));
  console.log("SAID under the third", ask());
  vi.doUnmock(name);
  console.log("SAID behind its end", ask());
});
