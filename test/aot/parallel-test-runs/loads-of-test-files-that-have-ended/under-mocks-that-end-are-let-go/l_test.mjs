import { heapStats } from "bun:jsc";
import { expect, test, vi } from "bun:test";
import { rate } from "./rates.mjs";

test("l", async () => {
  expect(rate(1)).toBe(1.5);
  vi.doMock("./rates.mjs", () => ({ rate: () => 7 }));
  expect((await import("./rates.mjs")).rate(1)).toBe(7);
  vi.doUnmock("./rates.mjs");
  Bun.gc(true);
  console.log("few are held", heapStats().heapSize < 24 * 1024 * 1024);
});
