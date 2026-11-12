// The file of the package leaves the program at the store, and the next require() is the test file's: it finds what was stored. A module inside node_modules would be given the original beside a mock of Vitest's kind.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => {
  const it = require("made-up-lib");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("loaded", ask());
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 }));
  say("mocked", ask());
  require.cache[key] = { exports: { a: "fake", n: 0 } };
  say("stored", ask(), !!require.cache[key]);
});
