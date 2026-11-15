// As ../the-mock-ends; a package loaded behind the end reads the file too.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "mock" })); const dep = await import("made-up-dep"), { p } = await import("made-up-pkg"); console.log("SAID under", dep.x, p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", p(), (await import("made-up-other")).o());
});
