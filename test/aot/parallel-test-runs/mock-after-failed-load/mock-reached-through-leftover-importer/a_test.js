// As ../factory-imports-other-mocked-module: the next import comes to the mocked module through mid.js, which the failed load left too.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); });
  console.log("SAID", await import("./all.js").catch(e => e.message));
  vi.doMock("./k.js", async () => { console.log("SAID factory runs"); await 0; return { x: "mock" }; });
  console.log("SAID seen", (await import("./later.js")).seen);
}, 3000);
