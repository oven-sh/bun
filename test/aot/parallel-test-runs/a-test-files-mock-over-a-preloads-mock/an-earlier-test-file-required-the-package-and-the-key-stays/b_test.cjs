const { test, vi, mock, jest } = require("bun:test");
const NAME = "pack/lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
let handle;
test("b", async () => {
  vi.doMock(NAME, () => ({ a: "one", n: -1 })); say("one laid");
  vi.doUnmock(NAME); say("ended");
  say("behind", await ask(), await ask());
});
