import { test, vi } from "bun:test";
test("the barrel under the mock and behind its end", async () => {
  vi.doMock("./tools.mjs", () => ({ kept: 10, both: "mock", added: 3 }));
  const user = await import("./user.mjs");
  console.log("SAID under", user.look());
  vi.doUnmock("./tools.mjs");
  console.log("SAID ended", user.look());
});
