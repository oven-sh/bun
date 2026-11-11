import { test, vi, mock } from "bun:test";
test("b", async () => {
  vi.doMock("made-up-dep", () => ({ x: "second" })); const pkg = await import("made-up-pkg"); console.log("SAID b under", pkg.p(), (await import("made-up-dep")).x); vi.doUnmock("made-up-dep"); console.log("SAID b ended", pkg.p());
});
