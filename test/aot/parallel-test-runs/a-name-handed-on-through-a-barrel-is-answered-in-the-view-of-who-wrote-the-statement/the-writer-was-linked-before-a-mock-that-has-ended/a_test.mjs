import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  vi.doUnmock("./part.cjs");
  console.log("SAID inner-linked-before_part-in-front_kept-alone_ended", user.look("early", "kept", "both", "own"));
});
