const { test, vi } = require("bun:test");
const key = require.resolve("./lib.cjs");
test("b", () => {
  vi.doMock("./lib.cjs", () => ({ a: "mine", n: -1 }));
  vi.doUnmock("./lib.cjs");
  const it = require("./lib.cjs");
  console.log("SAID b", it.a, it.n + Number(process.env.ADD || 0), typeof require.cache[key], key in require.cache);
});
