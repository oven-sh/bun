import { test, vi } from "bun:test";
globalThis.door = Promise.resolve(1);
test("a", async () => {
  vi.doMock("./kiln.mjs", async () => { console.log("SAID factory called"); await 0; return { look: () => "mock" }; });
  for (let n = 0; n < 2; n++) {
    try { console.log("SAID require gave " + Object.keys(import.meta.require("./kiln.mjs")).join()); } catch (error) { console.log("SAID require threw " + error.name); }
  }
  console.log("SAID import " + (await import("./kiln.mjs").then(it => it.look(), error => error.name)));
});
