const { test, vi, mock, jest } = require("bun:test");
const NAME = "pack/lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
let handle;
test("a", async () => {
  say("first", await ask());
  try { handle = vi.doMock(NAME, async () => { await 0; return { a: "again", n: -2 }; }); } catch (error) { say("the call threw", error.name); }
  say("again", await ask());
});
