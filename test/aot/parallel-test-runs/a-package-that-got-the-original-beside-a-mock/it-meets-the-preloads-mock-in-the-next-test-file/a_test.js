// The package was linked to the original beside the test file's vi.doMock(). In the next test file the preload's mock.module() stands again: it finds the file's own key empty and patches nothing, so the package keeps the original.
import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./k.js", () => ({ x: "first" })); const k = (await import("./k.js")).x, pkg = await import("pkg"); console.log("SAID a", k, pkg.p());
  vi.doUnmock("./k.js"); console.log("SAID ended", pkg.p());
});
