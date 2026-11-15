import { mock, test } from "bun:test";
mock.module("./fx.mjs", async () => ({ rate: "mock " + (await import("./tax.mjs")).rate }));
test("a", async () => {
  console.log("a", (await import("./sale.mjs")).sold());
});
