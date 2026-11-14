const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.cjs")); } catch (error) { return { a: error.name }; } };
const say = (at, it, first) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  globalThis.first = ask(); const entry = require.cache[key]; const handle = vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); ask(); const first = globalThis.first;
  require.cache[key] = fake(); ask(); delete require.cache[key];
  vi.doUnmock("./lib.cjs");
  vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; }); say("actual", await actual(), first); say("required", ask(), first);
});
