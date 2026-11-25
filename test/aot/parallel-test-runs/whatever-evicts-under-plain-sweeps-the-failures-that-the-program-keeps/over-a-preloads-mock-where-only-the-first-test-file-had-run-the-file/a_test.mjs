import { test, vi } from "bun:test";
test("a", async () => {
  vi.doUnmock("./tray.mjs");
  console.log("a", (await import("./tray.mjs")).o);
});
