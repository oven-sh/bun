const { test, vi, mock, jest } = require("bun:test");
const NAME = "pack/lib.cjs";
const ask = async () => { try { const it = require(NAME); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
let handle;
test("a", async () => {
  say("first", await ask());
  vi.doMock(NAME, () => ({ a: "one", n: -1 })); say("one laid");
  jest.resetModules(); say("reset");
  mock.module(NAME, () => ({ a: "two", n: -2 })); say("two laid");
  vi.doMock(NAME, () => ({ a: "three", n: -3 })); say("three laid");
  vi.doUnmock(NAME); say("ended");
  say("behind", await ask(), await ask());
});
