const { test, vi } = require("bun:test");
test("the original is the namespace of the file", async () => {
  const required = require("./lib.cjs");
  const original = await vi.importActual("./lib.cjs");
  console.log("SAID", required.a, Object.prototype.toString.call(original), Object.keys(original).join(), "__esModule" in original, original.a);
});
