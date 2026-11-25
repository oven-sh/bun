import { jest, test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
  console.log("SAID", jest.requireActual<any>("./pool.cjs").query("one"));
});
test("two", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "second" }));
});
