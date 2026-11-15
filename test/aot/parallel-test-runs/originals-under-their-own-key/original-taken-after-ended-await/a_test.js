import { test, vi } from "bun:test";
globalThis.door = Promise.resolve(1);
test("a", async () => {
  vi.doMock("./kiln.mjs", async original => { console.log("SAID factory called"); const real = await original(); return { look: () => "over " + real.look() }; });
  for (let n = 0; n < 2; n++) {
    try { console.log("SAID require gave " + Object.keys(import.meta.require("./kiln.mjs")).join()); } catch (error) { console.log("SAID require threw " + error.name); }
  }
  console.log("SAID import " + (await import("./kiln.mjs").then(it => it.look(), error => error.name)));
});
