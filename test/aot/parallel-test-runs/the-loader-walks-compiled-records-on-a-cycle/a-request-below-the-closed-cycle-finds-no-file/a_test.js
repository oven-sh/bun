import { test } from "bun:test";
const tell = e => e.name + ": " + String(e.message).replace(/["'`][^"'`]*[\\/]/g, "'").slice(0, 70);
test("t", async () => {
  try { console.log("SAID", (await import("./reads.mjs")).seen()); } catch (e) { console.log("SAID threw", tell(e)); }
  try { console.log("SAID again", (await import("./reads.mjs")).seen()); } catch (e) { console.log("SAID again threw", tell(e)); }
  try { console.log("SAID a member", (await import("./ring-b.mjs")).seen()); } catch (e) { console.log("SAID a member threw", tell(e)); }
  // Whether first.cjs has run by the time the load fails wavers in plain Bun on a busy machine. No ES module may have run.
  console.log("SAID bodies of ES modules", String((globalThis.order ?? []).filter(name => name !== "first" && name !== "job")));
});
