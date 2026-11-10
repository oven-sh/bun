// mid.js stayed linked to the file k.js beside the first mock. It holds the file until it is loaded anew: neither the first mock, once it has ended, nor the second reaches it.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); });
  const failed = await import("./all.js").catch(error => error.message), actual = (await vi.importActual("./k.js")).x;
  vi.doMock("./k.js", () => ({ x: "first" })); const later = await import("./later.js"), k = (await import("./k.js")).x; console.log("SAID", failed, actual, k, later.m());
  vi.doUnmock("./k.js");
  vi.doMock("./k.js", () => ({ x: "second" })); const two = (await import("./k.js")).x; console.log("SAID under", two, later.m());
  vi.doUnmock("./k.js"); console.log("SAID ended", later.m());
});
