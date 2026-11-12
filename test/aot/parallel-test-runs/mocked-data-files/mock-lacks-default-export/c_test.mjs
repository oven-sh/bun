import { afterEach, beforeAll, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  console.log("SAID c", await (await import("./sale.mjs")).sold());
});
