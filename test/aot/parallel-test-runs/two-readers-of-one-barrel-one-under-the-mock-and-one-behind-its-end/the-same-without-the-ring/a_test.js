import { test, vi } from "bun:test";
test("both are linked anew by one load", async () => {
  vi.doMock("./part.mjs", () => ({ sep: "mock", extra: "more" }));
  const first = await import("./one.mjs");
  console.log("SAID under", first.late());
  await import("./more.mjs");
  vi.doUnmock("./part.mjs");
  try { await import("./wants-more.mjs"); } catch (error) { console.log("SAID refused", error.constructor.name); }
  const second = await import("./later.mjs");
  console.log("SAID behind", second.ask());
});
