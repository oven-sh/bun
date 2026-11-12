const { test, vi, mock } = require("bun:test");
const NAME = "made-up-pack/lib.cjs";
const key = require.resolve(NAME);
test("t", () => {
  const first = require(NAME);
  vi.doMock(NAME, () => ({ n: -1 }));
  mock.module(NAME, () => ({ n: -2 }));
  require.cache[key] = { exports: { n: -3 } };
  vi.doUnmock(NAME);
  delete require.cache[key];
  vi.doMock(NAME, () => ({ n: -4 }));
  vi.doUnmock(NAME);
  const last = require(NAME);
  console.log("SAID", last === first, last.n, globalThis.runsOfLib);
});
