import { jest, test, vi } from "bun:test";
vi.mock("@made-up/fx", async () => ({ rate: "mock of a" }));
test("a", () => {
  console.log("a", jest.requireActual("@made-up/fx").rate);
});
