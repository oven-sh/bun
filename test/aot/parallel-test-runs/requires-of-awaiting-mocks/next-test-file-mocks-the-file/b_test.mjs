import { jest, mock, test, vi } from "bun:test";
mock.module("./tax.mjs", async () => {
  console.log("factory");
  await 0;
  return { rate: "mock" };
});
test("b", async () => {
  console.log("b actual", (await vi.importActual("./tax.mjs")).rate);
  console.log("b require", require("./tax.mjs").rate);
  console.log("b import", (await import("./tax.mjs")).rate);
});
