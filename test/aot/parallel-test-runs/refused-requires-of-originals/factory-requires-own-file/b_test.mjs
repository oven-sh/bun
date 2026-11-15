import { jest, mock, test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", await import("./tax.mjs").then(it => it.rate + it.under?.()));
});
