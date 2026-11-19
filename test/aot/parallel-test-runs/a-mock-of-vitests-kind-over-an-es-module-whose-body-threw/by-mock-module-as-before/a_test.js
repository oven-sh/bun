import { test, vi, mock, jest } from "bun:test";
test("t", async () => {
  console.log("SAID", await import("./part.mjs").then(() => "loaded", error => error.message));
  mock.module("./part.mjs", () => ({ default: 1 }));
  console.log("SAID", await import("./part.mjs").then(() => "loaded", error => error.message));
});
