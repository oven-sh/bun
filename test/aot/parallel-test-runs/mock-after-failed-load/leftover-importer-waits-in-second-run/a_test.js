import { test, vi } from "bun:test";
Bun.plugin({
  name: "served",
  setup(build) {
    build.onLoad({ filter: /served\.js$/ }, async () => {
      await 0;
      return { contents: 'export const served = "served";', loader: "js" };
    });
  },
});
test("a", async () => {
  vi.doMock("./three.js", async () => {
    await null;
    throw new Error("three fails");
  });
  console.log("SAID", await import("./all.js").catch(error => error.message));
  vi.doMock("./k.js", async () => {
    console.log("SAID factory runs");
    await 0;
    return { x: "mock" };
  });
  console.log("SAID seen", (await import("./later.js")).seen);
}, 3000);
