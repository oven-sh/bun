const { test } = require("bun:test");
test("t", async () => {
  console.log("SAID", require("./lib.cjs").n, (await import("./lib.cjs")).n);
});
