import { afterAll, afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("./tax.json", async () => { await 0; return { rate: "bR", fee: () => "bF", default: { rate: "bR" } }; });
test("b", async () => {
  console.log("SAID b", await sold());
  console.log("SAID b direct", await import("./tax.json").then(it => it.rate ?? it.default?.rate));
});
test("b2", async () => { console.log("SAID b2", await sold()); });
