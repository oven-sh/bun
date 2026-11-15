import { test, vi, mock, jest } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const lay = word => vi.doMock("./k.js", () => ({ x: word }));
test("x", async () => {
  console.log("SAID", await fail("./all.js")); console.log("SAID actual", (await vi.importActual("./k.js")).x);
  lay("first"); console.log("SAID seen", (await import("./later.js")).seen());
});
