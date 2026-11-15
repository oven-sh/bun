const { test, vi } = require("bun:test");
test("t", () => {
  vi.doMock("./lib.mjs");
  try { console.log("SAID", require("./lib.mjs").a); } catch (error) { console.log("SAID it threw", error.name); }
  try { console.log("SAID", require("./lib.mjs").a); } catch (error) { console.log("SAID it threw", error.name); }
});
