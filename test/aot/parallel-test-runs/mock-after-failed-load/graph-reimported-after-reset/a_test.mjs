import { afterEach, beforeEach, expect, jest, mock, test, vi } from "bun:test";

afterEach(() => {
  vi.resetModules();
  delete process.env.K123_URL;
});

test("the service is down", async () => {
  await expect(import("./app.mjs")).rejects.toThrow("K123_URL is not set");
});

test("with the variable", async () => {
  process.env.K123_URL = "here";
  vi.doMock("./settings.mjs", () => ({ region: "mock" }));
  const { start } = await import("./app.mjs");
  console.log("SAID", start());
  expect(start()).toBe("here list mock");
});
