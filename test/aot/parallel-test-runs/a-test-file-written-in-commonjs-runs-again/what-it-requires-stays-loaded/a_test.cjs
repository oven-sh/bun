const { test } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
test("t", () => {
  console.log("SAID", run, require("./gauge.cjs").word, globalThis.bodies);
});
