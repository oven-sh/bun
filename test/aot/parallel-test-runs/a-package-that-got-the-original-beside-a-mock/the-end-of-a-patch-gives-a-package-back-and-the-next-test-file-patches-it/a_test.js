// As its neighbour, with the third patch laid by the next test file.
import { test, vi, mock } from "bun:test";
test("x", async () => {
  vi.doMock("dep", () => ({ x: "first" })); const { held, p } = await import("pkg"); console.log("SAID under", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); mock.module("dep", () => ({ x: "second" })); console.log("SAID second", (await import("dep")).x, held(), await p());
  vi.doUnmock("dep"); console.log("SAID ended", held(), await p());
});
