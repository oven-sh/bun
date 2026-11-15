import { jest, mock, test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.doMock("./data.json", () => ({ v: "mock" }));
test("b", async () => {
  console.log("b", sold(), (await import("./shop.mjs")).shown());
});
