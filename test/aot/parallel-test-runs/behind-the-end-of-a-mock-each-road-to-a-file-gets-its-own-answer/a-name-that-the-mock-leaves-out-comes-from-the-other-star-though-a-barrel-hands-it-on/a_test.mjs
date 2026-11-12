import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ extra: 10 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID", user.look("kept", "both", "own"), "|", [...globalThis.ran].sort().join(""));
});
