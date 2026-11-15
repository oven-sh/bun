import { test, vi } from "bun:test";
import "./middle.mjs";
test("t", async () => {
  vi.doMock("./part.cjs", () => ({ kept: 10, early: 20 }));
  const user = await import("./user.mjs");
  console.log("SAID under", user.look());
  vi.doUnmock("./part.cjs");
  console.log("SAID at once", user.look());
  const next = await import("./part.cjs");
  console.log("SAID behind a load", user.look(), "|", Object.keys(next).join(), next.kept);
  console.log("SAID once more", user.look(), globalThis.ran);
});
