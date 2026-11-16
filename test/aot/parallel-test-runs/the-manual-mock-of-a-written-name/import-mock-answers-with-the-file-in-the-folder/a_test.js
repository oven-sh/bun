import { test, vi } from "bun:test";
test("vi.importMock", async () => {
  console.log("SAID", (await vi.importMock("./src/lib.js")).who, (await import("./src/lib.js")).who);
});
