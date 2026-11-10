const { test, vi } = require("bun:test");
test("t", async () => {
  const held = require("./part.mjs");
  console.log("SAID first", held.a);
  try { vi.doMock("./part.mjs", () => { console.log("SAID the factory runs"); return { a: "mocked" }; }); console.log("SAID the call returned"); } catch (error) { console.log("SAID the call threw", error.message); }
  try { const all = require("./part.mjs"); console.log("SAID required", Object.keys(all).sort().join(), all.a); } catch (error) { console.log("SAID the require threw", error.message); }
  console.log("SAID held", held.a);
});
