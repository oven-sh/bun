import { jest, test, vi } from "bun:test";
jest.doMock("@made-up/fx", () => ({ rate: "patch of b" }));
vi.mock("@made-up/fx", async () => {
  await 0;
  return { rate: "mock of b" };
});
test("b", () => {
  console.log("b");
});
