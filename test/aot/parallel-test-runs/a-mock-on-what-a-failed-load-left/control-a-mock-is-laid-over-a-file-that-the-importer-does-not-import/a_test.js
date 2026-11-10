// The importer that was left stays linked to the module that had run.
import { test, vi, mock, jest } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
const made = word => () => { console.log("SAID factory " + word + " runs"); return { x: word }; };
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  vi.doUnmock("./three.js");
  vi.doMock("./k.js", made("first"));
  vi.doMock("./k.js", made("second"));
  vi.doMock("./far.js", () => ({ far: "mocked far" }));
  console.log("SAID far", (await import("./far.js")).far);
  vi.doUnmock("./far.js");
  console.log("SAID seen", (await import("./later.js")).seen);
  console.log("SAID k", (await import("./k.js")).x);
});
