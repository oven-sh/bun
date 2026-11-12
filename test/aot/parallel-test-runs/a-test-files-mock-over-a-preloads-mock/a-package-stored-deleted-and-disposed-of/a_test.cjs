// As ../a-package-and-the-mock-is-taken-off: the program stores a module of its own under the key and deletes it, and the handle is disposed of.
const { test, vi, mock } = require("bun:test");
const key = require.resolve('made-up-lib');
const ask = async () => { try { const it = await import('made-up-lib'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  const handle = vi.doMock('made-up-lib', () => ({ a: "mine", n: -1 }));
  say("mocked", await ask());
  require.cache[key] = fake(); delete require.cache[key];
  say("ops", await ask(), !!require.cache[key]);
  handle[Symbol.dispose]();
  say("ended", await ask(), !!require.cache[key], await ask());
});
