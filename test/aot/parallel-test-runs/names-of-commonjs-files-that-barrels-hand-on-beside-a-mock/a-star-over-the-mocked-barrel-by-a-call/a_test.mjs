import { test, mock } from "bun:test";
mock.module("./prices.mjs", () => ({ rate: "the rate of the mock of prices.mjs" }));
test("the mock of the barrel answers", async () => {
  console.log((await import("./shop.mjs")).rate);
});
