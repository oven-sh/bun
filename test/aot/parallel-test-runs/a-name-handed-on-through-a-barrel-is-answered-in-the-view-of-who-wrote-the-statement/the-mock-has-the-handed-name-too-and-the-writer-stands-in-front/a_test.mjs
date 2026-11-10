import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10, early: 20 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID inner-linked-before_inner-in-front_the-handed-name-too_ended", user.look("early", "kept", "both", "own"));
});
