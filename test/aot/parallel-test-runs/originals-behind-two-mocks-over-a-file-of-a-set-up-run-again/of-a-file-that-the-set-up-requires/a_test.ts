import { jest, mock, test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
  mock.module("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID actual", jest.requireActual<any>("./pool.cjs").id, (await vi.importActual<any>("./pool.cjs")).id);
});
