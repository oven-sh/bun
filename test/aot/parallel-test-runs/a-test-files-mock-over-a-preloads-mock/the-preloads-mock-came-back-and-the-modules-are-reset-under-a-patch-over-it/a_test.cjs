const { test, vi, mock, jest } = require("bun:test");
const NAME = "./lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("first", await ask());
  vi.doMock(NAME, () => ({ a: "one", n: -1 }));
  vi.doMock(NAME, () => ({ a: "two", n: -2 })); say("two", await ask()); vi.doUnmock(NAME);
  mock.module(NAME, () => ({ a: "three", n: -3 })); say("three", await ask()); vi.resetModules(); vi.doUnmock(NAME);
  say("at the end of a", await ask(), !!require.cache[require.resolve(NAME)]);
});
