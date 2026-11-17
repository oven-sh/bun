import { heapStats } from "bun:jsc";
import { expect, test, vi } from "bun:test";
import { rate } from "./rates.mjs";
import { price } from "./price.mjs";

test("l", () => {
  expect(rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
  Bun.gc(true);
  console.log("few are held", heapStats().heapSize < 24 * 1024 * 1024);
});
