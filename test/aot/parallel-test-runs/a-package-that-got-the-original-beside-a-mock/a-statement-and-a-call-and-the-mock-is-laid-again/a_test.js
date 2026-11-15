// The package holds the original by a statement and asks for it by a call of import(). Both get the file beside a mock of vitest's kind, behind its end, under the next one and behind the end of that.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("made-up-dep", () => ({ x: "first" })); const { held, p } = await import("made-up-pkg"); console.log("SAID under", (await import("made-up-dep")).x, held(), await p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended", held(), await p());
  vi.doMock("made-up-dep", () => ({ x: "second" })); console.log("SAID second", (await import("made-up-dep")).x, held(), await p());
  vi.doUnmock("made-up-dep"); console.log("SAID ended again", held(), await p());
});
