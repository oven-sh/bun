const { test, vi } = require("bun:test");
test("the importer gets the mock, not the original's namespace", async () => {
  const required = require("./lib.cjs");
  const original = await vi.importActual("./lib.cjs");
  const { seen, whole } = await import("./helper.mjs");
  console.log("SAID", required.a, Object.prototype.toString.call(original), original.a, seen(), whole === original, original.a);
});
