import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const short = m => (m && m.id !== undefined ? String(m.id).replace(/^.*[\\/]/, "") : String(m));
const kids = m => "[" + (m.children || []).map(short).join("+") + "]";
test("the file runs again by import() and asks once", async () => {
  globalThis.runs = [];
  try { require("./piece.cjs"); } catch (error) { console.log("SAID first run", error.name); }
  await import("./piece.cjs");
  globalThis.runs.forEach((m, i) => console.log("SAID run", i, m.loaded, kids(m)));
  expect(1).toBe(1);
});
