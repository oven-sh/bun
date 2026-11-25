import { test, vi } from "bun:test";
test("the namespace and the name under the mock", async () => {
  vi.doMock("./shapes.mjs", () => ({ sep: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
