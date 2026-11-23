import { test, vi } from "bun:test";
import "./early.js";
test("the namespace", async () => {
  vi.doMock("./tools.cjs", () => ({ default: 1, kept: 10, added: 3 }));
  await import("./asks.js");
  const user = await import("./user.js");
  vi.doUnmock("./tools.cjs");
  console.log("SAID", user.look("added"));
});
