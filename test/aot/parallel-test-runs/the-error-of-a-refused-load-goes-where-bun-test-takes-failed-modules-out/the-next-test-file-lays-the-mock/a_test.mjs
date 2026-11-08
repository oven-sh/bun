import { test } from "bun:test";
import { far } from "./far.mjs";
test("the first file", async () => {
  try { await import("./ledger.mjs"); } catch (error) { globalThis.first = error; }
  console.log("SAID first", globalThis.first.name, far);
});
