// The mock stands in place before the import under way is linked: it still reads the file, whose body runs beside the mock.
import { test, vi, mock } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({ name: "slow", setup(build) { build.onLoad({ filter: /slow\.js$/ }, async () => { asked.resolve(); await gate.promise; return { contents: 'export const s = "slow";', loader: "js" }; }); } });
test("x", async () => {
  const user = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", () => { console.log("SAID factory runs"); return { x: "mock" }; });
  console.log("SAID two", (await import("./r.cjs")).default.seen);
  gate.resolve();
  console.log("SAID seen", (await user).seen);
}, 3000);
