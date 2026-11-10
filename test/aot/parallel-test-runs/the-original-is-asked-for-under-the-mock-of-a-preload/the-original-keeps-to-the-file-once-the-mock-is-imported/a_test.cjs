const { test, vi } = require("bun:test");
test("the original stays the original", async () => {
  require("./lib.cjs");
  const original = await vi.importActual("./lib.cjs");
  const mocked = await import("./lib.cjs");
  console.log("SAID", original.a, mocked.a, original === mocked);
});
