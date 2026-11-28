import { test, vi } from "bun:test";
test("a mock is laid over what the file required", async () => {
  console.log((await import("./user.cjs")).ask());
  vi.doMock("./words.cjs", () => ({ word: "mock" }));
  console.log((await import("./user.cjs")).ask());
});
