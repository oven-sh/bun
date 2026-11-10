const { test, vi } = require("bun:test");
test("the original stays the original", async () => {
  require("./lib.cjs");
  const before = await vi.importActual("./lib.cjs");
  const mocked = await import("./lib.cjs");
  const behind = await vi.importActual("./lib.cjs");
  console.log("SAID", mocked.a, Object.prototype.toString.call(behind), behind.a, before === behind);
});
