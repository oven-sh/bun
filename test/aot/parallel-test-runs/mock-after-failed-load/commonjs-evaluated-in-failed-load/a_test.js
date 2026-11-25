// The failed load left mid.js with the loader, linked to the CommonJS file k.cjs, which ran in that load. A mock laid on k.cjs now leaves mid.js linked to the file. Whoever imports k.cjs anew gets the mock.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const lay = word => vi.doMock("./k.cjs", () => { console.log("SAID factory " + word + " runs"); return { x: word }; });
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  lay("first");
  console.log("SAID seen", (await import("./later.js")).seen());
  console.log("SAID k", (await import("./k.cjs")).x);
});
