// As ../a-text-calls-import-on-a-text-above-both, but the file above both is compiled: the loader fetches it for the text, and that one fetch starts both factories.
import { test, vi } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  globalThis.runs = {};
  vi.doMock("./one.js", async () => { await null; const other = await import("./two.js"); return { one: "mock 1 < " + other.two }; });
  vi.doMock("./two.js", async () => { await null; await null; await null; await null; return { two: "mock 2" }; });
  const outer = await import("./outer.js");
  console.log("SAID", outer.seen, "|", JSON.stringify(globalThis.runs));
}, 3000);
