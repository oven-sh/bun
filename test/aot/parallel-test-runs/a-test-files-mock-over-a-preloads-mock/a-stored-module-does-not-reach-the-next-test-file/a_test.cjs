// Whatever was stored in require.cache, the next test file begins with the preload's mock.
const { test, vi, mock } = require("bun:test");
const key = require.resolve('made-up-lib');
const ask = async () => { try { const it = require('made-up-lib'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  const handle = vi.doMock('made-up-lib', () => ({ a: "mine", n: -1 }));
  say("mocked", await ask());
  require.cache[key] = fake();
  say("ops", await ask(), !!require.cache[key]);
  
  say("ended", await ask(), !!require.cache[key], await ask());
});
