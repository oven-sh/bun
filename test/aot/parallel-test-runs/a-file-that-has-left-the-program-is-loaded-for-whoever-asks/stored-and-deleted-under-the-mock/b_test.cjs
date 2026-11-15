const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => {
  const it = require("made-up-lib");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", () => {
  say("b", ask(), !!require.cache[key], ask());
});
