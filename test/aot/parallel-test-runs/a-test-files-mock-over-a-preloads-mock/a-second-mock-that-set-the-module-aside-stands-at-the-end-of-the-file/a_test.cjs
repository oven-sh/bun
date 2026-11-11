const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = require("./lib.cjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all, process.argv.length > 9 ? 1 : 0);
test("a", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.cjs"); say("ended", await ask());
  vi.doMock("./lib.cjs", () => ({ a: "again", n: -2 })); say("again", await ask());
});
