const { test, vi } = require("bun:test");
test("the original is the namespace of the file", async () => {
  const original = await vi.importActual("./lib.cjs");
  console.log("SAID", globalThis.requiredByThePreload.a, Object.prototype.toString.call(original), Object.keys(original).join(), "__esModule" in original, original.a);
});
