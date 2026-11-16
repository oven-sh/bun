import { test, vi } from "bun:test";
test("one", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "first" }));
  console.log("SAID", require("./users.ts").find());
});
test("two", () => {
  vi.doMock("./pool.cjs", () => ({ query: () => "second" }));
  console.log("SAID", require("./users.ts").find());
});
