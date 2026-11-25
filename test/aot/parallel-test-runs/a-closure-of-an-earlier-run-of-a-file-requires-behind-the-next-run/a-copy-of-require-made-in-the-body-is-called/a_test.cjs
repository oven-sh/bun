const { test } = require("bun:test");
test("t", async () => {
  await require("./main.cjs");
});
