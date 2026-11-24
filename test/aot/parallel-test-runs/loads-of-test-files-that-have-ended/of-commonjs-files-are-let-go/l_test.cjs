const { heapStats } = require("bun:jsc");
const { expect, test, vi } = require("bun:test");
const { rate } = require("./rates.cjs");
const price = require("./price.cjs");

test("l", () => {
  expect(rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
  Bun.gc(true);
  console.log("few are held", heapStats().heapSize < 24 * 1024 * 1024);
});
