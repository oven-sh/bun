import { mock, test, vi } from "bun:test";
test("a", async () => {
  mock.module("@made-up/absent/part", () => ({ word: "mock of a" }));
  console.log("SAID a", (await import("./user.mjs")).user());
});
