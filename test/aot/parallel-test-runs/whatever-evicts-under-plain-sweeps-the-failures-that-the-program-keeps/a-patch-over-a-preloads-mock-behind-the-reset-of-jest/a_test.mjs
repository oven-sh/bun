import { test, vi, mock, jest } from "bun:test";
test("a", async () => {
  await import("./tray.mjs");
  jest.resetModules();
});
