const { test, mock, vi, jest } = require("bun:test");
test("t", async () => {
  await import("./part.cjs").then(part => console.log("SAID first gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID first threw", error.name));
  try { vi.doMock("./part.cjs", () => { console.log("SAID the factory runs"); throw new RangeError("made up"); }); console.log("SAID the call returned"); } catch (error) { console.log("SAID the call threw", error.name); }
  await import("./part.cjs").then(part => console.log("SAID second gave", Object.keys(part).sort().join(), part.a), error => console.log("SAID second threw", error.name));
});
