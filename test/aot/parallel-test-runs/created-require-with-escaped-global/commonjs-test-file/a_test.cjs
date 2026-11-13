const { test } = require("bun:test");
const { createRequire } = require("node:module");

const load = createRequire(__filename);

test("the file loads once and is cached", () => {
  console.log(load("./src/user.cjs").describe(1));
  console.log(load("./src/user.cjs").describe("a"), load("./src/user.cjs") === load("./src/user.cjs"));
});
