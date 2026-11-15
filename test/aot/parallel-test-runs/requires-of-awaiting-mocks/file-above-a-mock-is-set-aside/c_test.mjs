import { jest, mock, test, vi } from "bun:test";
vi.mock("./fx.mjs", () => ({ rate: "mock" }));
test("c", async () => {
  await import("./sale.mjs");
  vi.doMock("./leaf.mjs", () => ({ leaf: "mock" }));
  vi.doMock("./tax.mjs", async () => {
    console.log("factory");
    await 0;
    return { rate: "mock" };
  });
  console.log("c", require("./tax.mjs").rate);
});
