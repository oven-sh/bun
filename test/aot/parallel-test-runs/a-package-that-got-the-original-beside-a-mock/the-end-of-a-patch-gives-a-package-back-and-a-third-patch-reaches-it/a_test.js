// Both are packages: the end of vi.doMock() brings the mocked one back under its own key, so a patch reaches whoever holds it, the end of the patch gives it back, and a third patch reaches it again.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("dep", () => ({ x: "first" })); const { held, p } = await import("pkg"); console.log("SAID under", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); mock.module("dep", () => ({ x: "second" })); console.log("SAID second", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); console.log("SAID ended", held(), await p());
  mock.module("dep", () => ({ x: "third" })); console.log("SAID third", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); console.log("SAID ended again", held(), await p());
});
