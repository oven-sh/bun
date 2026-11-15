import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
vi.doMock("tax", { spy: true });
test("b", async () => {
  console.log("SAID b", await (await import("./sale.mjs")).sold());
});
test("b2", async () => { console.log("SAID b2", await (await import("./sale.mjs")).sold()); });
