const { test } = require("bun:test");
test("b", async () => {
  console.log("SAID b", (await import("pack/greeting.cjs")).word);
});
