// leads-to-all.js runs from its text. Its load fails by the factory of three.js, and leaves mid.js, one.js and two.js with the loader, fetched and never linked. A mock laid on one of them takes that entry out, so the next import fetches the module and comes to the mock.
import { test, vi } from "bun:test";
Bun.plugin({ name: "served", setup(build) { build.onLoad({ filter: /served\.js$/ }, async () => { await 0; return { contents: 'export const served = "served";', loader: "js" }; }); } });
test("x", async () => {
  globalThis.runs = {};
  vi.doMock("./three.js", async () => { await null; throw new Error("three fails"); });
  const a = import("./uses-three.js").catch(e => e.message);
  const b = import("./leads-to-all.js").catch(e => e.message);
  const early = [await a, await b].join(" , ");
  vi.doMock("./one.js", async () => { await null; const other = await import("./two.js"); return { one: "mock 1 < " + other.two }; });
  vi.doMock("./two.js", async () => { await null; await null; await null; await null; return { two: "mock 2" }; });
  const [c, d] = await Promise.all([import("./uses-one.js"), import("./uses-two.js")]);
  console.log("SAID", early, "|", c.seen, "|", d.seen, "|", JSON.stringify(globalThis.runs));
}, 3000);
