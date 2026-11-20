import { test } from "bun:test";
test("text and data beside require", async () => {
  try { await import("./lib.js"); } catch (e) { console.log(e.name + ": " + e.message); }
});
