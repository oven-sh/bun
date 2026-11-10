import { test, vi } from "bun:test";
vi.mock("./part.js", async importOriginal => { const original = await importOriginal(); const a = await import("./a.js"); return { part: `mock ${original.part} ${original.seesRing()} ${typeof a.a}` }; });
test("t", async () => {
  console.log(`| SAID ${(await import("./b.js")).readA()}`);
  vi.resetModules();
  console.log(`| SAID ${(await import("./b.js")).readA()}`);
});
