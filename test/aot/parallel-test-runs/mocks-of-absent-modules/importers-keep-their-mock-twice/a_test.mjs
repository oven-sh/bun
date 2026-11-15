import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./absent.mjs", () => ({ word: "first", more: "more of the first" }));
  const first = await import("./user.mjs");
  vi.doMock("./absent.mjs", () => ({ word: "second", more: "more of the second" }));
  const second = await import("./user.mjs");
  console.log("SAID a", first === second, first.user(), second.user());
  globalThis.kept = [first, second];
});
