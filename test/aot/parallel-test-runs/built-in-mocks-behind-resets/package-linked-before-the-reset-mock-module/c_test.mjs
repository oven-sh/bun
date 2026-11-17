import { mock, test, vi } from "bun:test";
test("c", async () => {
  mock.module("node:os", () => ({ platform: () => "mocked" }));
  console.log("c", (await import("./user.mjs")).user());
});
