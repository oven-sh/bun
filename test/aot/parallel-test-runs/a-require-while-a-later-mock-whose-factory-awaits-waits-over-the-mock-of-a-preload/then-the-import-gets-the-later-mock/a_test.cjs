const { test, vi, mock, jest } = require("bun:test");
test("t", async () => {
  vi.doMock("./part.cjs", async () => { await 0; return { a: "later" }; });
  console.log("SAID required", require("./part.cjs").a);
  console.log("SAID again", require("./part.cjs").a);
  console.log("SAID imported", (await import("./part.cjs")).a);
  console.log("SAID required behind it", require("./part.cjs").a);
  console.log("SAID the preload holds", heldByThePreload.a);
});
