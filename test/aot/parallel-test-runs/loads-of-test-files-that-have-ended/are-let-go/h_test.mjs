import { expect, test, vi } from "bun:test";
import { rate } from "./rates.mjs";
import { price } from "./price.mjs";

test("h", () => {
  expect(rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
});
