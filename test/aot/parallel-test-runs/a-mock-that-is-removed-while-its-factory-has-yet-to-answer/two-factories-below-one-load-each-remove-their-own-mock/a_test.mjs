import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./one.mjs", () => (vi.doUnmock("./one.mjs"), { a: "mock" }));
  vi.doMock("./two.mjs", () => (vi.doUnmock("./two.mjs"), { b: "mock" }));
  console.log("SAID", (await import("./user.mjs")).seen);
  console.log("SAID", (await import("./one.mjs")).a, (await import("./two.mjs")).b);
});
