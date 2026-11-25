import { jest, mock, test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
  console.log("SAID mocked", require("./users.ts").find());
  mock.module("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID actual", (await vi.importActual<any>("./pool.cjs")).id);
});
