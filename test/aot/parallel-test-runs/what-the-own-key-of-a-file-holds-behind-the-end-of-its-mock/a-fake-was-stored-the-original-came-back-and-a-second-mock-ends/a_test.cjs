const { test, vi } = require("bun:test");
const NAME = "made-up-pack/lib.cjs";
const key = require.resolve(NAME);
test("t", () => {
  const first = require(NAME);
  vi.doMock(NAME, () => ({ a: "one", n: -1 }));
  require.cache[key] = { exports: { a: "fake" } };
  vi.doUnmock(NAME);
  const m1 = require.cache[key]; m1.mark = 1;
  vi.doMock(NAME, () => ({ a: "two", n: -2 }));
  vi.doUnmock(NAME);
  console.log("SAID again", require.cache[key] === m1, require.cache[key].mark, require(NAME) === first, globalThis.runsOfLib);
});
