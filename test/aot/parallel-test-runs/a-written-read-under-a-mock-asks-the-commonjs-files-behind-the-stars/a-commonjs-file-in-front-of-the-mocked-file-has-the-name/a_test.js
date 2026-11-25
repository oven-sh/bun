import { test, vi } from "bun:test";
test("the name under the mock", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
