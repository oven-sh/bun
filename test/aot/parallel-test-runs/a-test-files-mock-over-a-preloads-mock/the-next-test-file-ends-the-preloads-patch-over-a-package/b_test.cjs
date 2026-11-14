const { test, vi, mock } = require("bun:test");
const key = require.resolve("made-up-lib");
const ask = () => { try { const it = require("made-up-lib"); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("b", () => { vi.doUnmock("made-up-lib"); say("b", ask(), ask()); });
