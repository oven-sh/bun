import { test, vi, mock, jest } from "bun:test";
test("a", async () => {
  await import("./tray.mjs");
  vi.resetModules();
  await import("./tray.mjs");
});
