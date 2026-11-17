import { jest, mock, test, vi } from "bun:test";
vi.mock("./tax.mjs", async () => {
  console.log("factory");
  await 0;
  return { rate: "mock" };
});
test("c", async () => {
  console.log("c actual", jest.requireActual("./tax.mjs").rate);
  console.log("c require", require("./tax.mjs").rate);
  console.log("c import", (await import("./tax.mjs")).rate);
});
