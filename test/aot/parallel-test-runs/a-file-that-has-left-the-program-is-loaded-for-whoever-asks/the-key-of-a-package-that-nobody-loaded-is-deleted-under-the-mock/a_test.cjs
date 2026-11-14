// The mock goes on answering behind the deletion.
const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => {
  const it = require("made-up-lib");
  return it.a + " " + it.n;
};
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", () => {
  vi.doMock("made-up-lib", () => ({ a: "mine", n: -1 }));
  say("mocked", ask());
  delete require.cache[key];
  say("deleted", ask(), !!require.cache[key]);
});
