import { afterEach, beforeEach, expect, jest, mock, test, vi } from "bun:test";

test("the service is down", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("service down");
});

test("the list", async () => {
  vi.doMock("./settings.mjs", () => ({ region: "mock" }));
  const { list } = await import("./store.mjs");
  console.log("SAID", list());
  expect(list()).toBe("list mock");
});
