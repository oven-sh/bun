// The loader keeps the entry of k.js for the import under way. An import() of k.js itself joins it: it gets the file, and no factory is called.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  const two = import("./k.js");
  gate.resolve();
  console.log("SAID seen", (await user).seen, (await two).x);
}, 3000);
