const { test, vi, mock, jest } = require("bun:test");
const NAME = "./lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
let handle;
test("a", async () => {
  say("first", await ask());
  handle = vi.doMock(NAME, () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  handle = vi.doMock(NAME, () => ({ a: "again", n: -2 })); say("again", await ask());
});
