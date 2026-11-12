import { test, vi } from "bun:test";
test("the namespace and the name under the mock", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 20 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
