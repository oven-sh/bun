import { test } from "bun:test";
const tell = e => e.name + ": " + String(e.message).replace(/["'`][^"'`]*[\\/]/g, "'").slice(0, 70);
test("t", async () => {
  try { console.log("SAID", (await import("./reads.mjs")).seen()); } catch (e) { console.log("SAID threw", tell(e)); }
  console.log("SAID", await globalThis.late);
  // Which of the two loads ends first, and so where the cycle is entered, wavers in plain Bun from run to run.
  console.log("SAID bodies", String([...globalThis.order].sort()));
});
