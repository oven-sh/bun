// As ../three-consecutive-mocks; nothing of it reaches the next test file.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const lay = word => vi.doMock("./k.js", () => { console.log("SAID factory " + word + " runs"); return { x: word }; });
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  lay("first"); lay("second");
  console.log("SAID seen", (await import("./later.js")).seen());
});
