import { expect, test, vi } from "bun:test";

test("the service is down", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("service down");
});

test("the list", async () => {
  vi.doMock("@r3825-made-up/settings", () => ({ region: "mock" }));
  const { list } = await import("@r3825-made-up/store");
  console.log("SAID", list(), globalThis.settingsRan);
});
