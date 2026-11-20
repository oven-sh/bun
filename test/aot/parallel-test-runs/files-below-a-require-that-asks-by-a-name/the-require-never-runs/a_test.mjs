import { test, mock } from "bun:test";
// A run in which some file mentions Bun.plugin asks the loader by the name at every require(). The mock stands, so totals.mjs finds a name of prices.cjs only in what the mock turns out to export.
import { plugin } from "bun";
globalThis.kept = plugin;
mock.module("./prices.cjs", () => ({ rate: "a mocked rate" }));
test("taxes.cjs never runs", async () => {
  console.log(require("./prices.cjs").rate);
  const { shown } = await import("./shop.mjs");
  console.log("nothing below has run", typeof shown);
});
