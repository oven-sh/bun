import { mock, test } from "bun:test";
mock.module("./dep.mjs", () => ({ kind: "whole", extra: "b" }));
test("b", async () => {
  const dep = await import("./dep.mjs");
  console.log("| b " + dep.kind + " " + dep.extra + " " + dep.run);
});
