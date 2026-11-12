import { mock, test, vi } from "bun:test";
test("c", async () => {
  mock.module("./absent.mjs", () => ({ word: "mock of c" }));
  console.log("SAID c", (await import("./user.mjs")).user());
});
