import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("pkg", async original => ({ ...(await original()), x: "a" }));
  console.log("SAID a", (await import("pkg")).x);
});
