const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = require(JSON.parse('"./lib.json"')); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("first", await ask());
  vi.doMock("./lib.json", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.json"); say("ended", await ask(), await ask());
});
