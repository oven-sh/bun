// The hook of the preload lays its mock over the one of this file. What the mock in the test sets aside is the instance of the hook's mock, and its end brings that back.
const { test, vi } = require("bun:test");
const name = "made-up-pack/lib.cjs";
const ask = () => require(name).who;
console.log("SAID at first", ask());
vi.doMock(name, () => ({ who: "of the file" }));
console.log("SAID of the file", ask());
test("one", () => {
  console.log("SAID in the test", ask());
  vi.doMock(name, () => ({ who: "of the test" }));
  console.log("SAID under it", ask());
  vi.doUnmock(name);
  console.log("SAID behind its end", ask());
});
