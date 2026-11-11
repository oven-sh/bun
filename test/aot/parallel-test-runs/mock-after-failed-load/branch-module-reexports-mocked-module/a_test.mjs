import { afterEach, beforeEach, expect, jest, mock, test, vi } from "bun:test";

test("the service is down", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("service down");
});

test("the region", async () => {
  vi.doMock("./settings.mjs", () => ({ region: "mock" }));
  const store = await import("./store.mjs");
  console.log("SAID", store.region);
  expect(store.region).toBe("mock");
});
