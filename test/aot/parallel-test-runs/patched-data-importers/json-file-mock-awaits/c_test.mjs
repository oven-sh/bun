import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("c", async () => {
  console.log("SAID c", await sold());
});
