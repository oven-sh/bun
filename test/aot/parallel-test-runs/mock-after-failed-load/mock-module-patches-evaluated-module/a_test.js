// mock.module() patches a module that has run: mid.js reads the mock.
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
  mock.module("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  console.log("SAID seen", (await import("./later.js")).seen);
});
