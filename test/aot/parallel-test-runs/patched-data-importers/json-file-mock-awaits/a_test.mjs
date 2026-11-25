import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
test("a", async () => {
  console.log("SAID a", await sold());
});
test("a2", async () => { console.log("SAID a2", await sold()); });
