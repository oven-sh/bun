import { afterAll, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  mock.module("@made-up/tax", () => ({ rate: "cR", fee: () => "cF", default: { rate: "cR" } }));
  console.log("SAID c", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
});
