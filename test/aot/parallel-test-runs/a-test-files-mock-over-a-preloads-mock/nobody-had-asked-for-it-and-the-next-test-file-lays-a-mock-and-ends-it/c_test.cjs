const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = await import("./lib.cjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("c", async () => {
  say("c", await ask());
});
