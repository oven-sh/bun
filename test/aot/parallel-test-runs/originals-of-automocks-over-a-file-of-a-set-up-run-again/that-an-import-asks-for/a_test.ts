import { jest, test, vi } from "bun:test";
test("first", async () => {
  vi.doMock("./pool.cjs");
  console.log("SAID automock", (await import("./users.ts")).find());
});
