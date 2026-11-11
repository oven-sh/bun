// As ../the-mock-ends: `export { x } from`: whoever reads the name off the package reads the file.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "first" })); const pkg = await import("made-up-pkg"); console.log("SAID under", (await import("made-up-dep")).x, pkg.x);
  vi.doUnmock("made-up-dep"); console.log("SAID ended", pkg.x, (await import("made-up-pkg")).x);
});
