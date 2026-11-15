const { test, vi, jest, mock } = require("bun:test");
const key = require.resolve("./lib.cjs");
const kind = it => Object.prototype.toString.call(it) + " " + Object.keys(it).join();
test("t", async () => {
  const first = require("./lib.cjs");
  jest.doMock("./lib.cjs", () => ({ a: "mocked" }));
  require("./lib.cjs");
  vi.doUnmock("./lib.cjs");
  require.cache[key] = undefined;
  jest.doMock("./lib.cjs", () => ({ a: "again" }));
  const second = require("./lib.cjs");
  vi.doUnmock("./lib.cjs");
  const third = require("./lib.cjs");
  console.log("SAID", second.a, third === first, kind(third), third.a, globalThis.runsOfLib);
});
