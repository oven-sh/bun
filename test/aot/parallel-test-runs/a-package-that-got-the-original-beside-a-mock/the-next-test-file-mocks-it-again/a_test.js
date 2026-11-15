// As ../the-mock-ends, once more in the next test file.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "mock" })); const dep = await import("made-up-dep"), { p } = await import("made-up-pkg"); console.log("SAID under", dep.x, p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", p());
});
