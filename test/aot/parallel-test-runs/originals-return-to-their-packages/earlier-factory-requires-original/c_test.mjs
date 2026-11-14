import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
test("c", async () => {
  console.log("SAID c", await (await import("./sale.mjs")).sold());
  console.log("SAID c direct", await import("@made-up/tax").then(it => it.rate ?? it.default?.rate));
});
