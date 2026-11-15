// z.js has yet to run, as the importer has: the importer is loaded anew to get the mock of z.js, and is linked anew to k.js too.
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
  vi.doMock("./z.js", () => ({ z: "mocked z" }));
  console.log("SAID seen", (await import("./later.js")).seen);
  console.log("SAID k", (await import("./k.js")).x);
});
