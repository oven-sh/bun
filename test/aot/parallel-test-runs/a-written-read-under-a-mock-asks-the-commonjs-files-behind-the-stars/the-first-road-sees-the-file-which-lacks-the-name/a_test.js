import { test, vi } from "bun:test";
import "./early.js";
test("members written on the namespace under the mock", async () => {
  vi.doMock("./tools.cjs", () => ({ default: 1, kept: 10, both: "mock", added: 3 }));
  const user = await import("./user.js");
  console.log("SAID", user.look());
});
