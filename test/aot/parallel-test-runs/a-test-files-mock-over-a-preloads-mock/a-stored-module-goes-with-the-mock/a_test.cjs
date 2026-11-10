// What the program stored under the key goes where the mock is taken off: the preload's mock is back.
const { test, vi, mock } = require("bun:test");
const key = require.resolve('./lib.cjs');
const ask = async () => { try { const it = require('./lib.cjs'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  const handle = vi.doMock('./lib.cjs', () => ({ a: "mine", n: -1 }));
  say("mocked", await ask());
  require.cache[key] = fake();
  say("ops", await ask(), !!require.cache[key]);
  vi.doUnmock('./lib.cjs');
  say("ended", await ask(), !!require.cache[key], await ask());
});
