const { test, vi, mock } = require("bun:test");
const ask = async () => { try { const it = require("made-up-lib"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => {
  say("b", await ask(), await ask());
});
