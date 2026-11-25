import { test, vi } from "bun:test";

test("a", async () => {
  vi.doMock("kit/first.mjs", () => ({ one: 10 }));
  vi.doMock("kit/second.mjs", () => ({ two: 20 }));
  console.log("first", (await import("kit/first.mjs")).one);
  console.log("second", (await import("kit/second.mjs")).two);
});
