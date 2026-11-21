import { afterEach, jest, mock, test, vi } from "bun:test";
import { price } from "./prices.mjs";
afterEach(() => void jest.resetModules());
test("the mock ends and another is laid", () => {
  vi.doMock("./rates.mjs", () => ({ rate: () => "mocked" }));
  vi.doUnmock("./rates.mjs");
  console.log("ended", price());
  mock.module("./rates.mjs", () => ({ rate: () => "stub" }));
  console.log("laid", price());
});
