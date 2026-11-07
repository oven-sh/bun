import { test } from "bun:test";
test("eager glob beside require", async () => {
  let said;
  try { await import("./lib.js"); said = globalThis.listed; } catch (e) { said = e.name; }
  console.log(said);
});
