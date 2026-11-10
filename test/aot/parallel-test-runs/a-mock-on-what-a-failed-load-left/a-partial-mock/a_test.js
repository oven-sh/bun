// As ../two-mocks-on-what-it-left-and-one-factory-imports-the-other-module: the factory takes the original, whose body runs now for the first time.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); });
  console.log("SAID", await import("./all.js").catch(e => e.message));
  vi.doMock("./k.js", async importOriginal => { const o = await importOriginal(); console.log("SAID factory runs"); return { x: "mock of " + o.x }; });
  console.log("SAID seen", (await import("./later.js")).seen);
}, 3000);
