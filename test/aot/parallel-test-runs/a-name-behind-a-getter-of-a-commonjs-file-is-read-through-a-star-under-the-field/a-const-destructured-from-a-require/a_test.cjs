const { test } = require("bun:test");
const { make } = require("./outer/index.mjs");
test("t", async () => {
  console.log("SAID", typeof make);
  await 0;
});
