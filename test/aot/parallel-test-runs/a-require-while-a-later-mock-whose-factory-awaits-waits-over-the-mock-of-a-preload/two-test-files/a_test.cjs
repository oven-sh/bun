const { test, vi, mock, jest } = require("bun:test");
test("a", async () => {
  vi.doMock("./part.cjs", async real => ({ ...(await real()), a: "later" }));
  console.log("SAID a", require("./part.cjs").a);
});
