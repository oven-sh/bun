import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "first" })); const dep = await import("made-up-dep"), { p } = await import("made-up-pkg"); console.log("SAID under", dep.x, p());
  mock.module("made-up-dep", () => ({ x: "second" })); console.log("SAID over", (await import("made-up-dep")).x, p());
});
