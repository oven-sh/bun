import { afterEach, beforeAll, jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
jest.mock("./tax.json", () => ({ ...require("./tax.json"), rate: "R" }));
test("b", async () => {
  console.log("SAID b", await sold());
  console.log("SAID b direct", JSON.stringify(await import("./tax.json")));
});
