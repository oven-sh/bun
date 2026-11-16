import { jest, test, vi } from "bun:test";
test("first", () => {
  vi.doMock("./pool.cjs", () => ({ id: 100, query: () => "first" }));
  console.log("SAID first", require("./users.ts").find());
});
test("second", () => {
  vi.doMock("./pool.cjs");
  console.log("SAID automock", require("./pool.cjs").id);
});
