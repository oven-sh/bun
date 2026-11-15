// A package gets the original beside a mock of vitest's kind. It holds it once the mock has ended; a file of the program, which saw the mock, keeps the mock.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "mock" })); const dep = await import("made-up-dep"), { p } = await import("made-up-pkg"); console.log("SAID under", dep.x, p());
  const { h } = await import("./helper.js"); console.log("SAID helper", h());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", p(), h(), (await import("made-up-dep")).x);
});
