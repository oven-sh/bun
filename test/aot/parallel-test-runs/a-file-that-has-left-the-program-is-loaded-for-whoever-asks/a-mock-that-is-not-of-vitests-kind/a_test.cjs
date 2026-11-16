// A control: mock.module() reaches the packages too: nobody is given an original beside it.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => {
  const it = require("made-up-lib");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("loaded", ask());
  mock.module("made-up-lib", () => ({ a: "mine", n: -1 }));
  say("mocked", ask());
  require.cache[key] = { exports: { a: "fake", n: 0 } };
  say("stored", ask(), !!require.cache[key]);
});
