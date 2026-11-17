import { afterEach, beforeAll, jest, mock, test, vi } from "bun:test";
vi.mock("./tax.json", () => ({ ...require("./tax.json"), rate: "R" }));
test("b", async () => {
  console.log("SAID b", await (await import("./sale.mjs")).sold());
  console.log("SAID b direct", JSON.stringify(await import("./tax.json")));
});
