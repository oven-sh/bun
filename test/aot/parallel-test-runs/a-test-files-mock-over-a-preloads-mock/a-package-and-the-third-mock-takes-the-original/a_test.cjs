const { test, vi, mock } = require("bun:test");
const NAME = "pack/lib.cjs";
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const ask = async () => { try { const it = own(await import(NAME)); return it.a + " " + it.n; } catch (error) { return error.name; } };
const say = (at, what) => console.log("SAID", at, globalThis.runsOfLib, what);
test("a", async () => {
  say("first", await ask());
  vi.doMock(NAME, () => ({ a: "mine", n: -1 })); say("mocked", await ask());
  mock.module(NAME, () => ({ a: "again", n: -2 })); say("again", await ask());
  vi.doMock(NAME, async original => { const it = own(await original()); return { a: "third " + it.a, n: -4 }; }); say("third", await ask());
  vi.doUnmock(NAME); say("behind the end", await ask());
});
