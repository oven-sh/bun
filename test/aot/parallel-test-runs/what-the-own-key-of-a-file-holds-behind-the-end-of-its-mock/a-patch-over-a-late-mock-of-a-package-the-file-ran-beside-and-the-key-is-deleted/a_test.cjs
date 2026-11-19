const { test, vi, mock, jest } = require("bun:test");
const NAME = "pack/lib.cjs";
const key = require.resolve(NAME);
let first;
const ask = () => { try { return require(NAME); } catch (error) { return { a: error.name }; } };
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual(NAME)); } catch (error) { return { a: error.name }; } };
const say = (at, it) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  let handle;
  handle = vi.doMock(NAME, async () => { await 0; return { a: "earlier", n: -1 }; });
  { const it = ask(); first ??= it; say("under the earlier", it); }
  delete require.cache[key]; say("behind the first verb", ask());
  handle = mock.module(NAME, () => ({ a: "later", n: -2 })); say("under the later", ask());
  mock.restore();
  say("required", ask()); say("actual", await actual()); say("again", ask()); console.log("SAID", key in require.cache);
});
