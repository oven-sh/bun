const { test, vi } = require("bun:test");
const ask = () => { try { const it = require("./lib.cjs"); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all, process.argv.length > 9 ? 1 : 0);
test("c", () => { say("next", ask()); });
