import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const ask = createRequire(import.meta.url);
void vi;
void mock;
test("a", async () => {
  console.log("SAID A", (await import("@k123-made/spring")).pull);
});
