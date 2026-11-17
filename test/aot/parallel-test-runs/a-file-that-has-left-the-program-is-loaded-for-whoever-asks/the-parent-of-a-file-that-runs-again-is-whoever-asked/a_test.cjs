// A file whose key was deleted runs again, and its `module.parent` is the module that asked for it.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => {
  const it = require("./lib.cjs");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  say("loaded", ask());
  delete require.cache[key];
  say("again", ask());
});
