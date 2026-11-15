import { jest, mock, test, vi } from "bun:test";
mock.module("./tax.mjs", () => ({ rate: "first" }));
test("a", async () => {
  console.log("a", (await import("./sale.mjs")).sold());
  console.log("a actual", jest.requireActual("./tax.mjs").rate);
});
