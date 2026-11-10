// mid.js has run, linked to the file k.js ahead of the first mock. A mock over mid.js itself comes and goes: mid.js comes back as it was, and the second mock over k.js does not reach it.
import { test, vi } from "bun:test";
Bun.plugin({ name: "texts", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
const fail = async root => { vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); }); return await import(root).catch(error => error.message); };
test("x", async () => {
  console.log("SAID", await fail("./all.js"));
  console.log("SAID actual", (await vi.importActual("./k.js")).x);
  vi.doMock("./k.js", () => ({ x: "first" }));
  console.log("SAID seen", (await import("./later.js")).seen());
  vi.doMock("./mid.js", () => ({ m: () => "mid mocked" }));
  console.log("SAID under", (await import("./mid.js")).m());
  vi.doUnmock("./mid.js");
  vi.doMock("./k.js", () => ({ x: "second" }));
  console.log("SAID behind", (await import("./mid.js")).m());
});
