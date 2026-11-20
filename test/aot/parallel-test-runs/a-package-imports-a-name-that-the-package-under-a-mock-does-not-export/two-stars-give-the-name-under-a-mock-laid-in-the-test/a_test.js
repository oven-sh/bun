import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("wick", () => ({ width: 2 }));
  const lamp = await import("lamp").catch(error => error);
  console.log(lamp instanceof Error ? lamp.name : Object.keys(lamp).join());
});
