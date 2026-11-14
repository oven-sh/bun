const { test, vi, mock, jest } = require("bun:test");
const NAME = "./lib.cjs";
const key = require.resolve(NAME);
let first;
const ask = () => { try { return require(NAME); } catch (error) { return { a: error.name }; } };
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual(NAME)); } catch (error) { return { a: error.name }; } };
const say = (at, it) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  let handle;
  first = ask(); say("in front", first);
  handle = vi.doMock(NAME, () => ({ a: "earlier", n: -1 }));
  { const it = ask(); first ??= it; say("under the earlier", it); }
  handle = mock.module(NAME, () => ({ a: "later", n: -2 })); say("under the later", ask());
  require.cache[key] = { exports: { a: "fake" } }; say("stored", ask()); delete require.cache[key]; say("behind the second verb", ask());
  handle = vi.doMock(NAME, () => ({ a: "third", n: -3 })); say("under the third", ask());
  try { handle?.[Symbol.dispose]?.(); } catch (error) { console.log("SAID dispose threw", error.name); }
  say("required", ask()); say("actual", await actual()); say("again", ask()); console.log("SAID", key in require.cache);
});
