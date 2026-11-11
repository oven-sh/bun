import { test, vi } from "bun:test";
const asked = Promise.withResolvers(), gate = Promise.withResolvers();
Bun.plugin({
  name: "late",
  setup(build) {
    build.onLoad({ filter: /slow\.js$/ }, async () => {
      asked.resolve();
      await gate.promise;
      return { contents: "export const s = 'slow';", loader: "js" };
    });
  },
});
test("an import under way", async () => {
  const first = import("./user.js");
  await asked.promise;
  vi.doMock("./k.js", () => ({ x: "mock", y: "m" }));
  gate.resolve();
  const seen = (await first).seen;
  console.log("SAID", seen, (await import("./late.js")).seen);
});
