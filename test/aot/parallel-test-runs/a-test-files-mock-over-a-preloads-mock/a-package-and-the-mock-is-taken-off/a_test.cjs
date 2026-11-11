// The preload has mocked the package; the test file lays a mock of its own over that and takes it off: the preload's mock is back.
const { test, vi, mock } = require("bun:test");
const key = require.resolve('made-up-lib');
const ask = async () => { try { const it = require('made-up-lib'); return it && it.a + " " + it.n; } catch (error) { return error.name; } };
const fake = () => ({ exports: { a: "fake", n: 0 } });
const say = (at, ...all) => console.log("SAID", at, globalThis.runsOfLib, ...all);
test("a", async () => {
  say("a", await ask());
  const handle = vi.doMock('made-up-lib', () => ({ a: "mine", n: -1 }));
  say("mocked", await ask());
  
  say("ops", await ask(), !!require.cache[key]);
  vi.doUnmock('made-up-lib');
  say("ended", await ask(), !!require.cache[key], await ask());
});
