const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const kind = it => Object.prototype.toString.call(it) + " " + Object.keys(it).join();
test("t", async () => {
  const first = require("./lib.cjs");
  mock.module("./lib.cjs", () => ({ a: "mocked" }));
  vi.doUnmock("./lib.cjs");
  require.cache[key] = undefined;
  const second = require("./lib.cjs");
  console.log("SAID", second === first, kind(second), second.a, globalThis.runsOfLib);
});
