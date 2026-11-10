import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID under the mock", user.look());
  vi.doUnmock("./part.cjs");
  console.log("SAID behind its end", user.look());
  const part = await import("./part.cjs");
  console.log("SAID behind a load", user.look(), "|", part.kept, part.leftOut);
});
