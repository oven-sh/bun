import { mock, test, vi } from "bun:test";
test("a", async () => {
  mock.module("./absent.mjs", () => ({ word: "mock of a" }));
  console.log("SAID a", (await import("./user.mjs")).user());
});
