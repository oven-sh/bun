import { mock, test, vi } from "bun:test";
import { price } from "./prices.mjs";
test("the mock ends and another is laid", async () => {
  vi.doMock("./rates.mjs", () => ({ rate: () => "mocked" }));
  vi.doUnmock("./rates.mjs");
  mock.module("./rates.mjs", () => ({ rate: () => "stub" }));
  console.log("laid", price(), (await import("./rates.mjs")).rate());
});
