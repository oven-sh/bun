// early.js ran from its text before the mocks were laid. It is finished, and counts for nothing.
import { test, vi } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  await import("./early.js");
  globalThis.runs = {};
  vi.doMock("./one.js", async () => { await null; const other = await import("./two.js"); return { one: "mock 1 < " + other.two }; });
  vi.doMock("./two.js", async () => { await null; await null; await null; await null; return { two: "mock 2" }; });
  const [a, b] = await Promise.all([import("./uses-one.js"), import("./uses-two.js")]);
  console.log("SAID", a.seen, "&", b.seen, "|", JSON.stringify(globalThis.runs));
}, 3000);
