import { test, vi } from "bun:test";
test("the namespace and the name under the mock", async () => {
  vi.doMock("./marks.mjs", () => ({ sep: "mock" }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
