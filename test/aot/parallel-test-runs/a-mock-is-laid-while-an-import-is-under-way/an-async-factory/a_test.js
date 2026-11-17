// The import under way was given k.js ahead of the mock: it runs the file. The factory is called for the import behind it.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", async () => { console.log("SAID factory runs"); await 0; return { x: "mock" }; });
  gate.resolve();
  console.log("SAID seen", (await user).seen);
  console.log("SAID later", (await import("./k.js")).x);
}, 3000);
