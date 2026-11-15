import { jest, test, vi } from "bun:test";
let count = 0;
const lay = () => { const tag = "stand-in " + ++count; vi.doMock("./anvil.mjs", () => ({ weight: tag })); };
test("whether the mocked file runs", async () => {
  lay();
  console.log("SAID first " + (await import("./forge.mjs")).look());
  vi.resetModules();
  vi.doUnmock("./anvil.mjs");
  console.log("SAID second " + (await import("./forge.mjs")).look() + " | " + globalThis.strikes);
});
