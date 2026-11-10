import { afterEach, expect, test, vi } from "bun:test";

vi.mock("./settings.mjs", { spy: true });

test("it says what is missing", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("K123_URL is not set");
});

test("the list", async () => {
  const { list } = await import("./store.mjs");
  console.log("SAID", list(), globalThis.settingsRan);
});
