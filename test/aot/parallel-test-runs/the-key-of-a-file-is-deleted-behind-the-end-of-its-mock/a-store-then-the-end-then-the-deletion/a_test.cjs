const { test, vi, mock } = require("bun:test");
const NAME = "made-up-pack/lib.cjs";
const key = require.resolve(NAME);
test("t", async () => {
  const first = require(NAME);
  vi.doMock(NAME, () => ({ n: -1 }));
  require.cache[key] = { exports: { n: -3 } };
  vi.doUnmock(NAME);
  delete require.cache[key];
  vi.doMock(NAME, () => ({ n: -4 }));
  const actual = await vi.importActual(NAME);
  const it = actual.default ?? actual;
  console.log("SAID", it === first, it.n, globalThis.runsOfLib);
});
