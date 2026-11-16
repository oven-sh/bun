// It hangs on where the file lies, not on how it is named.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("./node_modules/made-up-lib/index.cjs");
const ask = () => {
  const it = require("./node_modules/made-up-lib/index.cjs");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("loaded", ask());
  vi.doMock("./node_modules/made-up-lib/index.cjs", () => ({ a: "mine", n: -1 }));
  say("mocked", ask());
  require.cache[key] = { exports: { a: "fake", n: 0 } };
  say("stored", ask(), !!require.cache[key]);
});
