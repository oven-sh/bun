import { jest, test, vi } from "bun:test";
test("a patch", () => {
  jest.doMock("./pool.mjs", () => ({ name: "first", run: 100 }));
});
test("a mock over it", () => {
  vi.doMock("./pool.mjs", () => ({ name: "second", run: 200 }));
  console.log("SAID the original", jest.requireActual<any>("./pool.mjs").run);
});
