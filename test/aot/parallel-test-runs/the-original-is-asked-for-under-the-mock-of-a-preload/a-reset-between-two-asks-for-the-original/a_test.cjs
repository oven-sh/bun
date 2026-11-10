const { test, vi } = require("bun:test");
test("the original follows the run that the require answers", async () => {
  const first = require("./lib.cjs");
  const before = await vi.importActual("./lib.cjs");
  vi.resetModules();
  const second = require("./lib.cjs");
  const behind = await vi.importActual("./lib.cjs");
  console.log("SAID", globalThis.runsOfLib, second === first, behind === before, behind.a, behind.default === second);
});
