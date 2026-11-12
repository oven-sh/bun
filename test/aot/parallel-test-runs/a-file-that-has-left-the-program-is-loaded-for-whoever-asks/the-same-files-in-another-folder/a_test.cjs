// A control: the same files outside node_modules.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("./parts/made-up-lib/index.cjs");
const ask = () => {
  const it = require("./parts/made-up-lib/index.cjs");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("loaded", ask());
  vi.doMock("./parts/made-up-lib/index.cjs", () => ({ a: "mine", n: -1 }));
  say("mocked", ask());
  require.cache[key] = { exports: { a: "fake", n: 0 } };
  say("stored", ask(), !!require.cache[key]);
});
