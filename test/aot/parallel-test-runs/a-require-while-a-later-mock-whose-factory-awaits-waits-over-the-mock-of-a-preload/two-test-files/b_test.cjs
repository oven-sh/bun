const { test, vi, mock, jest } = require("bun:test");
test("b", async () => {
  console.log("SAID b", require("./part.cjs").a, (await import("./part.cjs")).a);
});
