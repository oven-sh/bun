// user.js runs from its text and imports mid.js, which is compiled and imports the mocked k.js. The fetch of mid.js takes the turn of the mock below it: taken back while the plugin waits, the factory is never called.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { console.log("SAID onLoad asked"); asked.resolve(); await gate.promise; console.log("SAID onLoad answers"); return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "first" }; });
  const user = import("./user.js");
  await asked.promise;
  vi.doUnmock("./k.js"); console.log("SAID unmock");
  gate.resolve();
  console.log("SAID seen", (await user).seen);
});
