// As ../the-mock-ends: the package reads neither the first mock nor the second.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "mock" })); const dep = await import("made-up-dep"), { p } = await import("made-up-pkg"); console.log("SAID under", dep.x, p());
  vi.doMock("made-up-dep", () => ({ x: "second" })); console.log("SAID replaced", p(), (await import("made-up-dep")).x, (await import("made-up-pkg")).p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", p());
});
