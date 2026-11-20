const { test, vi, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
const fake = () => ({ exports: { a: "fake" } });
const own = m => (m && m.default && m.default.a !== undefined ? m.default : m) ?? {};
const actual = async () => { try { return own(await vi.importActual("./lib.cjs")); } catch (error) { return { a: error.name }; } };
const say = (at, it, other) => console.log("SAID", globalThis.runsOfLib, at, it.a, it.n, it === other);
test("t", async () => {
  const handle = vi.doMock("./lib.cjs", async () => { await 0; return { a: "mocked", n: -1 }; }); const first = ask();
  delete require.cache[key]; handle[Symbol.dispose](); say("required", ask(), first); say("actual", await actual(), first);
});
