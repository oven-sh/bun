import { jest, mock, test, vi } from "bun:test";
vi.mock("@made-up/tax", async () => {
  console.log("factory");
  await 0;
  return { rate: "mock" };
});
test("a", () => {
  console.log("a actual", jest.requireActual("@made-up/tax").rate);
  console.log("a require", require("@made-up/tax").rate);
});
