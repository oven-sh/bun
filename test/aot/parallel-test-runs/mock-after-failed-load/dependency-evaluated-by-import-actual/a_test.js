// The failed load left mid.js with the loader, linked to k.js. vi.importActual() has run k.js since. A mock laid on k.js now leaves mid.js linked to the file: no factory is called for it. Whoever imports k.js anew gets the mock.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "texts", setup(build) {
  build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; });
  build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; });
} });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const lay = word => vi.doMock("./k.js", () => { console.log("SAID factory " + word + " runs"); return { x: word }; });
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  lay("mock");
  console.log("SAID seen", (await import("./later.js")).seen);
  console.log("SAID k", (await import("./k.js")).x);
});
