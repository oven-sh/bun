import { jest, mock, test, vi } from "bun:test";
test("loads", () => {
  const { say } = require("./requires.cjs");
  vi.doMock("./other.cjs", () => ({ from: "mock" }));
  say();
});
