import { expect, test, vi } from "bun:test";
import * as rates from "./rates.mjs";
import { price } from "./price.mjs";

test("i", () => {
  expect(rates.rate(1) + price(2)).toBe(6.5);
  vi.resetModules();
});
