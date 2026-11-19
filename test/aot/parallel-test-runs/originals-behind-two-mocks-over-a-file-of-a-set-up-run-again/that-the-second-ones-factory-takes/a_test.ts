import { jest, mock, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
});
test("two", () => {
  jest.doMock("./pool.cjs", () => ({ ...jest.requireActual<any>("./pool.cjs"), extra: 1 }));
  console.log("SAID partial", require("./users.ts").find());
});
