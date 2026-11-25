import { jest, test, vi } from "bun:test";
test("first", () => {
  vi.doMock("./pool.cjs");
  console.log("SAID automock", require("./pool.cjs").id, require("./users.ts").find());
});
