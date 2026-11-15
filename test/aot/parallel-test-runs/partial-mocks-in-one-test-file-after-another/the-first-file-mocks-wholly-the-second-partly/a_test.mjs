import { mock, test } from "bun:test";
mock.module("./dep.mjs", () => ({ kind: "whole", extra: "a" }));
test("a", async () => {
  const dep = await import("./dep.mjs");
  console.log("| a " + dep.kind + " " + dep.extra + " " + dep.run);
});
