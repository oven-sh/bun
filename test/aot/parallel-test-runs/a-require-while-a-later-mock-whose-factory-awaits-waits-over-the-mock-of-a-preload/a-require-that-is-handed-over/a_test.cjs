const { test, vi, mock, jest } = require("bun:test");
test("t", async () => {
  vi.doMock("./part.cjs", async real => ({ ...(await real()), a: "later" }));
  console.log("SAID required", [require][JSON.parse("0")]("./part.cjs").a);
  console.log("SAID again", [require][JSON.parse("0")]("./part.cjs").a);
  console.log("SAID the preload holds", heldByThePreload.a);
});
