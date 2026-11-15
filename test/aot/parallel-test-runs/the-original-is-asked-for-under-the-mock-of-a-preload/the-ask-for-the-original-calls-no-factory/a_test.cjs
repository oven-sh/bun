const { test, vi } = require("bun:test");
test("t", async () => {
  require("./lib.cjs");
  const original = await vi.importActual("./lib.cjs");
  console.log("SAID", Object.prototype.toString.call(original), original.a, globalThis.callsOfTheFactory, globalThis.runsOfLib);
  console.log("SAID", require("./lib.cjs").a, globalThis.callsOfTheFactory, globalThis.runsOfLib);
  console.log("SAID", (await import("./lib.cjs")).a, original.a, globalThis.callsOfTheFactory, globalThis.runsOfLib);
  console.log("SAID", require("./lib.cjs").a, globalThis.callsOfTheFactory, globalThis.runsOfLib);
});
