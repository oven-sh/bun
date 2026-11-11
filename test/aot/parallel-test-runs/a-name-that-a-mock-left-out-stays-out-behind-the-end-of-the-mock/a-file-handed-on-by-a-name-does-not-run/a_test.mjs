import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ default: 1, kept: 10 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID", user.look("two"));
});
