import { test, vi } from "bun:test";
import "./inner.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  
  console.log("SAID inner-linked-before_inner-in-front_kept-alone_standing", user.look("early", "kept", "both", "own"));
});
