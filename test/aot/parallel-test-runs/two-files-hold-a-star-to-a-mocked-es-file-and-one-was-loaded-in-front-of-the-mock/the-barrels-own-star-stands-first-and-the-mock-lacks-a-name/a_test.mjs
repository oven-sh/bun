import { test, vi } from "bun:test";
import "./early.mjs";
test("the namespace of the barrel under the mock", async () => {
  vi.doMock("./tools.mjs", () => ({ kept: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
