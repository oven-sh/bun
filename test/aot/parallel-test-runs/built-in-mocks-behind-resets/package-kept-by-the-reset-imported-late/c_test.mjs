import { test, vi } from "bun:test";
test("c", async () => {
  vi.doMock("node:os", () => ({ platform: () => "mocked" }));
  console.log("c", (await import("./user.mjs")).user());
});
