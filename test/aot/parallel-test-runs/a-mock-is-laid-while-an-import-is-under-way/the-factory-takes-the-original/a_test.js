// The factory asks for the original behind the import under way, which has run it.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", async importOriginal => { const o = await importOriginal(); console.log("SAID factory runs"); return { x: "mock of " + o.x }; });
  gate.resolve();
  console.log("SAID seen", (await user).seen);
  console.log("SAID later", (await import("./k.js")).x);
}, 3000);
