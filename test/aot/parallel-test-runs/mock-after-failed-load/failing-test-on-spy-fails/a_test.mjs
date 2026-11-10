import { afterEach, expect, test, vi } from "bun:test";

vi.mock("./settings.mjs", { spy: true });

test("it says what is missing", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("K123_URL is not set");
});

test("a wrong test", async () => {
  const { list } = await import("./store.mjs");
  expect(list()).toContain("undefined");
});
