import { jest, mock, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
});
test("two", () => {
  jest.doMock("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID actual", jest.requireActual<any>("./pool.cjs").id);
});
