import { jest, test, vi } from "bun:test";
let count = 0;
const lay = () => { const tag = "stand-in " + ++count; vi.doMock("./anvil.mjs", () => ({ weight: tag })); };
test("whether the mocked file runs", async () => {
  lay();
  const held = await import("./forge.mjs");
  vi.resetModules();
  lay();
  console.log("SAID second " + (await import("./forge.mjs")).look());
  console.log("SAID held " + held.look());
});
