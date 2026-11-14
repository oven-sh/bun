import { test, vi } from "bun:test";
test("the namespace under the mock", async () => {
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 10 }));
  const user = await import("./user.mjs");
  console.log("SAID", user.look());
});
