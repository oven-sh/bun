import { test, vi } from "bun:test";
test("the namespace and the name under the mock", async () => {
  vi.doMock("./more.cjs", () => ({ kept: 10, round: 20 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
  vi.doUnmock("./more.cjs");
  console.log("SAID behind the end", user.look());
});
