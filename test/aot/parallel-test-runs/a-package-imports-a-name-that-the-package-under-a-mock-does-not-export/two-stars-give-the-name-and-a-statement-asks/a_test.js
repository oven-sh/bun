import { test, vi } from "bun:test";
vi.mock("wick", () => ({ width: 2 }));
test("a", async () => {
  const lamp = await import("lamp").catch(error => error);
  console.log(lamp instanceof Error ? lamp.name + " " + /ambiguous/.test(lamp.message) : lamp.got);
});
