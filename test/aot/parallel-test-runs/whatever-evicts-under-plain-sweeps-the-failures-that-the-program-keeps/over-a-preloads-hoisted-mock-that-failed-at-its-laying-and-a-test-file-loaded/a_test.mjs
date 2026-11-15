import { test } from "bun:test";
test("a", async () => {
  console.log("a", (await import("./tray.mjs")).o);
});
