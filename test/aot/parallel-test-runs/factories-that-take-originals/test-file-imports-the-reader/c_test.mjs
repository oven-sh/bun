import { jest, mock, test, vi } from "bun:test";
jest.mock("./tax.mjs", () => {
  console.log("factory of tax");
  return { ...jest.requireActual("./tax.mjs"), rate: "mock" };
});
jest.mock("./fx.mjs", () => {
  console.log("factory of fx");
  return { ...jest.requireActual("./fx.mjs"), rate: "fxMock" };
});
test("c", async () => {
  const { sold } = await import("./sale.mjs");
  console.log("c", sold());
});
