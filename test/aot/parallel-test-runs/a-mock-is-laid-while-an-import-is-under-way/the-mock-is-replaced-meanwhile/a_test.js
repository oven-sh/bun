// The second mock comes over the first while the import is still under way: that import keeps the file all the same.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  vi.doMock("./k.js", () => { console.log("SAID second factory runs"); return { x: "second" }; });
  gate.resolve();
  console.log("SAID seen", (await user).seen);
  console.log("SAID later", (await import("./k.js")).x);
}, 3000);
