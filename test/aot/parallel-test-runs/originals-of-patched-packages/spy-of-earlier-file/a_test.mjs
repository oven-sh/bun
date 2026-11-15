import { jest, test, vi } from "bun:test";
test("a", () => {
  vi.doMock("@made-up/tax", { spy: true });
  console.log("a", jest.requireActual("@made-up/tax").rate);
});
