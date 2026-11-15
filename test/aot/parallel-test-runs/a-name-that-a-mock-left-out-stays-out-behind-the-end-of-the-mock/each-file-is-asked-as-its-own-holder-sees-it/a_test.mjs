import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./other.cjs", () => ({ extra: 30 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./other.cjs");
  console.log("SAID", user.look("kept", "both", "extra"));
});
