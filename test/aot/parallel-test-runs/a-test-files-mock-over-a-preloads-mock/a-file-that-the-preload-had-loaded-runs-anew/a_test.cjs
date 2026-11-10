// A file of the program that the preload had loaded first: at the end of the test file's mock it runs anew. The next test file begins with the preload's mock.
const { test, vi, mock } = require("bun:test");
const key = require.resolve('./lib.cjs');
const ask = async () => { try { const it = require('./lib.cjs'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  const handle = vi.doMock('./lib.cjs', () => ({ a: "mine", n: -1 }));
  say("mocked", await ask());
  delete require.cache[key];
  say("ops", await ask(), !!require.cache[key]);
  vi.doUnmock('./lib.cjs');
  say("ended", await ask(), !!require.cache[key], await ask());
});
