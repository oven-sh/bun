import { test } from "bun:test";
test("b", async () => {
  try { console.log("SAID b", String(await (await import("./reader.mjs")).look())); } catch (e) { console.log("SAID b", e.name); }
});
