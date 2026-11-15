import { mock, test, vi } from "bun:test";
test("a", async () => {
  mock.module("./tax.cjs", () => ({ ...require("./tax.cjs"), rate: 9 }));
  console.log("SAID a", (await import("./sale.mjs")).sold());
});
