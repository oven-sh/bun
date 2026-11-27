import { mock, test, vi } from "bun:test";
test("one", () => {
  mock.module("./config.cjs", () => ({ mode: "first" }));
  vi.doMock("./config.cjs", () => ({ mode: "second" }));
});
