import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  console.log("SAID c", await (await import("./sale.mjs")).sold());
});
test("c2", async () => { console.log("SAID c2", await (await import("./sale.mjs")).sold()); });
