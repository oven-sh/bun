import { jest, mock, test, vi } from "bun:test";
test("first", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
  console.log("SAID first", require("./users.ts").find());
  mock.module("./pool.cjs", () => ({ query: () => "patched" }));
  console.log("SAID actual", jest.requireActual<any>("./pool.cjs").id);
});
test("second", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID second", require("./users.ts").find());
});
test("third", async () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "third" }));
  console.log("SAID actual", (await vi.importActual<any>("./pool.cjs")).id);
});
