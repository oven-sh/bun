const { test, vi, mock, jest } = require("bun:test");
const NAME = "./lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => {
  vi.doMock(NAME, () => ({ a: "theirs", n: -7 })); say("theirs", await ask());
  vi.doUnmock(NAME); say("ended", await ask());
});
