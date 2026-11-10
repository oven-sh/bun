// As ../a-commonjs-file-ran-in-the-failed-load: a require() behind the mock gets the mock.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const lay = word => vi.doMock("./k.cjs", () => { console.log("SAID factory " + word + " runs"); return { x: word }; });
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  lay("first");
  console.log("SAID seen", (await import("./later.js")).seen(), (await import("./r.cjs")).r());
});
