// As ../the-module-itself-is-imported-meanwhile: the body of k.js runs for the second import, ahead of the first.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  console.log("SAID two", (await import("./k.js")).x);
  gate.resolve();
  console.log("SAID seen", (await user).seen);
}, 3000);
