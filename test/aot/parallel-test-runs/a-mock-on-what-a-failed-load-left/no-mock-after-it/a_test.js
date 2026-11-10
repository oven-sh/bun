// What the failed load left is loaded and run by the next import, once.
import { test, vi, mock } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); });
  console.log("SAID", await import("./all.js").catch(e => e.message));
  vi.doUnmock("./three.js");
  console.log("SAID seen", (await import("./later.js")).seen);
  console.log("SAID again", await import("./all.js").then(() => "came", e => e.message));
}, 3000);
