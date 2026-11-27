import { mock, test, vi } from "bun:test";
test("b", async () => {
  mock.module("./tax.cjs", () => ({ ...require("./tax.cjs"), rate: 9 }));
  console.log("SAID b", (await import("./sale.mjs")).sold());
});
