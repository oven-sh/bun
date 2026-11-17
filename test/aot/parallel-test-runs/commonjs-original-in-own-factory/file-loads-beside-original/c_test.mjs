import { mock, test, vi } from "bun:test";
test("c", async () => {
  
  console.log("SAID c", (await import("./sale.mjs")).sold());
});
