const { expect, test, vi } = require("bun:test");
const { rate } = require("./rates.cjs");
const price = require("./price.cjs");

test("h", () => {
  expect(rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
});
