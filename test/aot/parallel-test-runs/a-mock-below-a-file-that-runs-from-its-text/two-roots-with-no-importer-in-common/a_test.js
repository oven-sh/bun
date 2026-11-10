// Each root runs from its text, above its own mock. The factory of the one imports the module of the other: no unfinished file imports both, so it gets the original, whose body runs.
import { test, vi } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./one.js", async () => { await null; const other = await import("./two.js"); return { one: "mock 1 < " + other.two }; });
  vi.doMock("./two.js", async () => { await null; await null; await null; await null; return { two: "mock 2" }; });
  const [a, b] = await Promise.all([import("./uses-one.js"), import("./uses-two.js")]);
  console.log("SAID", a.seen, "|", b.seen, "|", globalThis.runsOfTwo);
}, 3000);
