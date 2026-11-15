const { test, vi, mock } = require("bun:test");
const NAME = "pack/lib.cjs";
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const ask = async () => { try { const it = own(require(NAME)); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, what) => console.log("SAID", at, globalThis.runsOfLib, what);
test("c", async () => {
  say("last", await ask());
});
