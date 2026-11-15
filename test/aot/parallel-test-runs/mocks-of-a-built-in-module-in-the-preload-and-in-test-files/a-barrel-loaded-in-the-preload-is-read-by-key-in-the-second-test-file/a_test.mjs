import { test, mock, vi } from "bun:test";
test("a", async () => {
  mock.module("node:path", () => ({ sep: "of a" }));
  await import("node:path");
});
