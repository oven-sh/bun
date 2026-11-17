const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.cjs")); } catch (error) { return { a: error.name }; } };
const say = (at, it, first) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  globalThis.first = ask(); const entry = require.cache[key]; const handle = vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; }); const first = globalThis.first;
  require.cache[key] = fake(); ask(); delete require.cache[key];
  vi.doMock("./lib.cjs", () => ({ a: "later", n: -2 })); vi.doUnmock("./lib.cjs");
  say("required", ask(), first); say("actual", await actual(), first); console.log("SAID", key in require.cache);
});
