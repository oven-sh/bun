const { test, vi } = require("bun:test");
test("t", async () => {
  const held = [require][JSON.parse("0")]("./part.mjs");
  console.log("SAID first", held.a);
  try { vi.doMock("./part.mjs", () => { console.log("SAID the factory runs"); throw new RangeError("of the factory"); }); console.log("SAID the call returned"); } catch (error) { console.log("SAID the call threw", error.message); }
  await import("./part.mjs").then(all => console.log("SAID imported", Object.keys(all).sort().join(), all.a), error => console.log("SAID the import threw", error.message));
  console.log("SAID held", held.a);
});
