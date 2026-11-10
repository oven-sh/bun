// Whatever was taken out of require.cache, the next test file begins with the preload's mock.
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
  
  say("ended", await ask(), !!require.cache[key], await ask());
});
