import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
test("a", async () => {
  (await import("./gauge.mjs"));
  const key = ask.resolve("./gauge.mjs");
  console.log("SAID A", (await import("./gauge.mjs")).read(), globalThis.turns);
});
