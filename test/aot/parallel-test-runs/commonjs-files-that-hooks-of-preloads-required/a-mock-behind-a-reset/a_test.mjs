import { mock, test, vi } from "bun:test";
test("modules are reset behind a mock", async () => {
  console.log((await import("./user.cjs")).ask());
  mock.module("./words.cjs", () => ({ word: "mock" }));
  vi.resetModules();
  console.log((await import("./user.cjs")).ask());
});
