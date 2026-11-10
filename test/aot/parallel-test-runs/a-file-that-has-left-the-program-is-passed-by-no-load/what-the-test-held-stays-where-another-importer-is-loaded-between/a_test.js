import { test, vi } from "bun:test";
let count = 0;
const lay = () => { const tag = "stand-in " + ++count; vi.doMock("./anvil.mjs", () => ({ weight: tag })); };
test("what the test held from its first import", async () => {
  lay();
  const held = await import("./forge.mjs");
  vi.resetModules();
  lay();
  console.log("SAID another importer " + (await import("./smithy.mjs")).look());
  console.log("SAID the same importer " + (await import("./forge.mjs")).look());
  let said;
  try { said = held.look(); } catch (error) { said = error.name; }
  console.log("SAID held " + said);
});
