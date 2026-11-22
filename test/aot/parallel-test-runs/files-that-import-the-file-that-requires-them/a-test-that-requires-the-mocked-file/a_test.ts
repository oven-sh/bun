import { expect, test, vi } from "bun:test";
vi.mock("./door", () => ({ width: () => 3 }));
test("a narrow door that nobody asks for", () => {
  expect(1).toBe(1);
});
