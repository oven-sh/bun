import { test, vi } from "bun:test";
test("the first mock", async () => {
  vi.doMock("./pool.mjs", () => ({ name: "first", run: 100 }));
  console.log("SAID first", (await import("./pool.mjs")).name);
});
test("the second mock", async () => {
  vi.doMock("./pool.mjs", () => ({ name: "second", run: 200 }));
  console.log("SAID second", (await import("./pool.mjs")).name);
});
