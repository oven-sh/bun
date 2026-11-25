const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
const ask = () => { try { return require("./lib.cjs"); } catch (error) { return { a: error.name }; } };
test("t", () => {
  const first = ask(); vi.doMock("./lib.cjs", () => ({ a: "mocked", n: -1 })); ask();
  require.cache[key] = { exports: { a: "fake" } }; ask(); delete require.cache[key];
  vi.doUnmock("./lib.cjs"); const last = ask(); console.log("SAID", last.a, last === first, globalThis.runsOfLib);
});
