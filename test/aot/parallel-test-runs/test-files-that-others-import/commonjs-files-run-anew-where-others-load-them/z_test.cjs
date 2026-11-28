const { test } = require("bun:test");
const { next } = require("./mocks_test.cjs");

test("z", () => {
  console.log("z", next());
});
