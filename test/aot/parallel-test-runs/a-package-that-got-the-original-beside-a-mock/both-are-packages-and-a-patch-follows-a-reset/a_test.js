// Both are packages: the end of vi.doMock() brings the mocked one back under its own key, so the patch reaches whoever holds it, also behind vi.resetModules().
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("dep", () => ({ x: "first" })); const { held, p } = await import("pkg"); console.log("SAID under", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); vi.resetModules(); mock.module("dep", () => ({ x: "second" })); const anew = await import("pkg"); console.log("SAID anew", held(), anew.held(), await anew.p());
});
