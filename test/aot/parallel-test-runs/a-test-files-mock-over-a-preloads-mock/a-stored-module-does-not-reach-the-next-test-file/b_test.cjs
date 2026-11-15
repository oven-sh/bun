const { test, vi, mock } = require("bun:test");
const key = require.resolve('made-up-lib');
const ask = async () => { try { const it = require('made-up-lib'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", async () => { say("b", await ask(), !!require.cache[key], await ask()); });
