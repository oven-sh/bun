const { test, expect } = require("bun:test");
test("the first call replaces what the file exports", () => {
  const first = require("./kind.cjs");
  const kind = first.kindOf(1);
  const second = require("./kind.cjs");
  console.log(kind, typeof first, typeof second, first === second, second.__esModule);
  expect(typeof second).toBe("function");
});
