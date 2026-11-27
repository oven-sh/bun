const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = await import("./lib.mjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all, process.argv.length > 9 ? 1 : 0);
test("a", async () => {
  vi.doMock("./lib.mjs", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.mjs"); say("ended", await ask());
  const lay = vi.mock; lay("./lib.mjs", () => ({ a: "again", n: -2 })); say("again", await ask());
});
