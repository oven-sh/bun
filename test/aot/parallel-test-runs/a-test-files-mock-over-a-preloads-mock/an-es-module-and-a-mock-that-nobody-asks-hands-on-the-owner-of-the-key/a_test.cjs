const { test, vi, mock } = require("bun:test");
const NAME = "./lib.mjs";
const ask = async () => { try { const it = await import(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("first", await ask());
  vi.doMock(NAME, () => ({ a: "one", n: -1 }));
  vi.doMock(NAME, () => ({ a: "two", n: -2 })); say("two", await ask()); vi.doUnmock(NAME);
  vi.doMock(NAME, () => ({ a: "three", n: -3 })); say("three", await ask()); vi.doUnmock(NAME);
  say("at the end of a", await ask());
});
