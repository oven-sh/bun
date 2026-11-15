// As ../leftover-importer-imports-in-function, at the top of mid.js.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "texts", setup(build) {
  build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; });
} });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  const mid = await import("./mid.js");
  console.log("SAID", mid.m, "in body", mid.inBody);
  console.log("SAID k", (await import("./k.js")).x);
});
