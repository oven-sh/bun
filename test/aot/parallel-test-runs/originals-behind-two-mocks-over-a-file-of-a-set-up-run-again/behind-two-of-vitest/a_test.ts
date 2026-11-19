import { jest, mock, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
});
test("two", async () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID actual", (await vi.importActual<any>("./pool.cjs")).id);
});
