import { jest, mock, test, vi } from "bun:test";
test("a", async () => {
  console.log("a", (await import("./dep.mjs")).name);
});
