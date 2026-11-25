import { test, mock } from "bun:test";
mock.module("./rates.cjs", () => ({ rate: "the rate of the mock of rates.cjs" }));
mock.module("./prices.mjs", () => ({ rate: "the rate of the mock of prices.mjs" }));
test("the first mock on the way answers", async () => {
  await import("./rates.cjs");
  await import("./prices.mjs");
  console.log((await import("./till.mjs")).shown());
});
