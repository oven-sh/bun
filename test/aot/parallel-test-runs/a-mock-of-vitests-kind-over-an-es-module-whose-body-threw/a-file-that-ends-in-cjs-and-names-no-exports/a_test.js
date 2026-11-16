import { test, vi, mock, jest } from "bun:test";
test("t", async () => {
  console.log("SAID", await import("./part.cjs").then(() => "loaded", error => error.message));
  vi.doMock("./part.cjs", () => ({ default: 1 }));
  console.log("SAID", await import("./part.cjs").then(() => "loaded", error => error.message));
});
