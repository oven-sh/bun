const { test, vi } = require("bun:test");
const ask = () => { const it = require("./gauge.cjs"); return it.word + " " + it.run; };
test("a", async () => {
  vi.doUnmock("./gauge.cjs");
  console.log("SAID the file", globalThis.runsOfGauge, ask());
  vi.doMock("./gauge.cjs", () => { vi.doUnmock("./gauge.cjs"); return { word: "one", run: -1 }; });
  console.log("SAID under one", globalThis.runsOfGauge, ask());
  console.log("SAID behind", globalThis.runsOfGauge, ask());
  console.log("SAID imported", globalThis.runsOfGauge, (await import("./gauge.cjs")).word);
});
