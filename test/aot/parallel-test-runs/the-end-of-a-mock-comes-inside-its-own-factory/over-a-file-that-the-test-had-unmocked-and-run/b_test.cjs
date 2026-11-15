const { test } = require("bun:test");
test("b", async () => {
  console.log("SAID next", globalThis.runsOfGauge, require("./gauge.cjs").word, (await import("./gauge.cjs")).word);
});
