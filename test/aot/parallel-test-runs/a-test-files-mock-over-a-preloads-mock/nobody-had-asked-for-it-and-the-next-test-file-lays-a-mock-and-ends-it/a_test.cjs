// As ../nobody-had-asked-for-the-preloads-mock: the next test file asks, lays its own and ends it: the preload's mock is back; so in the third.
const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = await import("./lib.cjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  vi.doUnmock("./lib.cjs"); say("ended", await ask(), await ask());
});
