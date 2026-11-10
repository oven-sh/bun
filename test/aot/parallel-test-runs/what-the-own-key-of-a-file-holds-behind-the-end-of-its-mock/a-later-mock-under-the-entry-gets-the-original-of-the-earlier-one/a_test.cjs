const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.cjs")); } catch (error) { return { a: error.name }; } };
const say = (at, it, first) => console.log("SAID", at, it.a, it.n, it === first, globalThis.runsOfLib);
test("t", async () => {
  const first = ask(); vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); say("under", ask(), first);
  require.cache[key] = fake(); vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; }); say("stored", ask(), first); delete require.cache[key]; say("actual", await actual(), first);
});
