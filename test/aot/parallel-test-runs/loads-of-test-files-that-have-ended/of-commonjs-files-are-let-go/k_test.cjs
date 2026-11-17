const { expect, test, vi } = require("bun:test");
const rates = require("./rates.cjs");
const price = require("./price.cjs");

test("k", () => {
  expect(rates.rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
});
