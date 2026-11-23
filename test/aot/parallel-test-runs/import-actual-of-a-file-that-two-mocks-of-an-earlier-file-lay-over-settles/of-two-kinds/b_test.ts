import { mock, test, vi } from "bun:test";
test("one", () => {
  mock.module("./config.cjs", () => ({ mode: "first" }));
});
test("two", () => {
  vi.doMock("./config.cjs", () => ({ mode: "second" }));
});
