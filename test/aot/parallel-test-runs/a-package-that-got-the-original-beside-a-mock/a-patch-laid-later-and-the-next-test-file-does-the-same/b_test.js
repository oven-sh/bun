import { test, vi, mock } from "bun:test";
test("y", async () => {
  vi.doMock("./k.js", () => ({ x: "of b" })); const pkg = await import("pkg"); console.log("SAID next", pkg.p(), (await import("./k.js")).x);
  vi.doUnmock("./k.js"); mock.module("./k.js", () => ({ x: "second of b" })); console.log("SAID under", (await import("./k.js")).x, pkg.p());
});
