import { test, vi } from "bun:test";
test("a partial mock ends", async () => {
  vi.doMock("./x", async original => ({ ...(await original()), rate: 9 }));
  const { go } = await import("./user");
  console.log("SAID a", go(), go(), go());
  vi.doUnmock("./x");
});
