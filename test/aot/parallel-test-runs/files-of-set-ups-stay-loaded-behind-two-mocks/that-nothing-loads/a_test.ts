import { test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
});
test("two", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "second" }));
});
