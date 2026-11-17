const { test, vi, mock, jest } = require("bun:test");
test("t", async () => {
  vi.doMock("./part.cjs", async real => ({ ...(await real()), a: "later" }));
  console.log("SAID required", require("./part.cjs").a);
  console.log("SAID again", require("./part.cjs").a);
  console.log("SAID the preload holds", heldByThePreload.a);
});
