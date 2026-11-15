// As ../the-mock-ends, by `import * as`.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "first" })); const { held, p } = await import("made-up-pkg"); console.log("SAID under", (await import("made-up-dep")).x, held(), await p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", held(), await p());
});
