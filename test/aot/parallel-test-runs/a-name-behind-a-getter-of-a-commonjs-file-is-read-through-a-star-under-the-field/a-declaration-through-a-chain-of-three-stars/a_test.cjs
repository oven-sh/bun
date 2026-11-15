const { test } = require("bun:test");
const make = require("./outer/index.mjs").make;
test("t", async () => {
  console.log("SAID", typeof make);
  await 0;
});
