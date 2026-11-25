import { test, vi } from "bun:test";
test("t", async () => {
  await import("./part.mjs");
  vi.doMock("./part.mjs", () => (vi.doUnmock("./part.mjs"), { a: "mock" }));
  console.log(`SAID ${(await import("./user.mjs")).seen} ${(await import("./part.mjs")).a} ${require("./part.mjs").a}`);
});
