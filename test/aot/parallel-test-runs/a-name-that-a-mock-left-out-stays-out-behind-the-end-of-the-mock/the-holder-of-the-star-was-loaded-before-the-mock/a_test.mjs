import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  const mocked = await import("./part.cjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID", user.look("kept", "leftOut"), "|", mocked.kept);
});
