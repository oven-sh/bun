import { afterAll, jest, mock, test, vi } from "bun:test";
test("b", async () => {
  console.log("SAID b", (await import("./sale.mjs")).sold(), (await import("@made-up/tax")).rate);
});
