import { test, mock } from "bun:test";
// A run in which some file mentions Bun.plugin asks the loader at every require(): a link of basket.cjs then goes down through what the file requires.
import { plugin } from "bun";
globalThis.kept = plugin;
mock.module("./prices.cjs", () => ({ rate: "a mocked rate" }));
test("the mock stands when basket.cjs is linked", async () => {
  console.log((await import("./prices.cjs")).rate);
  console.log((await import("./basket.cjs")).summary);
  console.log((await import("./shop.mjs")).shown);
});
