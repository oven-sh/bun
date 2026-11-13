const { test } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
if (run === 2) throw new RangeError("second");
test("t", () => {
  console.log("SAID", run);
});
