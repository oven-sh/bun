import { test } from "bun:test";
test("t", async () => {
  (await import("./reads.mjs")).seen();
  console.log("SAID", String(globalThis.jobs && [...globalThis.jobs].sort()), "|", [...globalThis.order].sort().join());
});
