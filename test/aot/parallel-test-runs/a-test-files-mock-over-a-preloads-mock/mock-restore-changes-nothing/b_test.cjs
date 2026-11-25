const { test, vi, mock } = require("bun:test");
const key = require.resolve('./lib.cjs');
const ask = async () => { try { const it = await import('./lib.cjs'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => { say("b", await ask(), !!require.cache[key], await ask()); });
