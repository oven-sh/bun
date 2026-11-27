import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  vi.doMock("./inner.mjs", () => ({ own: "mock" }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID", user.look("kept", "both", "own", "early"), "|", [...globalThis.ran].sort().join(""));
});
