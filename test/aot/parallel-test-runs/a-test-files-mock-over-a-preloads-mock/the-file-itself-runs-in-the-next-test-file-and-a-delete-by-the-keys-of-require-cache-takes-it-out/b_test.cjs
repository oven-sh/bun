const { test, vi } = require("bun:test");
test("b", () => {
  vi.doUnmock("./lib.cjs");
  const first = require("./lib.cjs");
  for (const each of Object.keys(require.cache)) {
    if (each.endsWith("lib.cjs")) delete require.cache[each];
  }
  const second = require("./lib.cjs");
  console.log("SAID b", first.a, first.n, second.a, second.n + Number(process.env.ADD || 0));
});
