const { test, vi } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
test("t", () => {
  vi.doMock("./gauge.cjs", () => ({ word: "test" + run }));
  console.log("SAID", run, require("./gauge.cjs").word, globalThis.bodies);
});
