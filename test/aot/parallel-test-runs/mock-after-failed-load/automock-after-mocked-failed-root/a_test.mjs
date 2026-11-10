import { expect, jest, test, vi } from "bun:test";
test("it says what is missing", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("K86_URL is not set");
});
test("behind a mock of the app", async () => {
  vi.doMock("./app.mjs", () => ({ start: () => "mocked" }));
  vi.doMock("./settings.mjs");
  const { list } = await import("./store.mjs");
  console.log("SAID", list());
  expect(list()).toBe("list real");
});
