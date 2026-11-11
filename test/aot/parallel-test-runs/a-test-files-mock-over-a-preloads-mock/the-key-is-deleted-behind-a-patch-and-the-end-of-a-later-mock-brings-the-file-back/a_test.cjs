// Behind the deletion the file itself runs. That instance is what the last mock sets aside, and its end brings it back, not the preload's mock.
const { test, vi, mock } = require("bun:test");
const name = "made-up-pack/lib.cjs";
const ask = () => require(name).who;
test("one", () => {
  console.log("SAID at first", ask());
  vi.doMock(name, () => ({ who: "of the test" }));
  console.log("SAID under it", ask());
  mock.module(name, () => ({ who: "a patch" }));
  vi.doUnmock(name);
  console.log("SAID behind its end", ask());
  delete require.cache[require.resolve(name)];
  console.log("SAID behind the deletion", ask());
  vi.doMock(name, () => ({ who: "the last" }));
  console.log("SAID under the last", ask());
  vi.doUnmock(name);
  console.log("SAID behind the end of the last", ask());
});
