import { test, mock } from "bun:test";
mock.module("./far.mjs", () => ({ v: "far" }));
mock.module("./near.mjs", () => ({ v: "near" }));
test("a", async () => {
  const far = await import("./far.mjs");
  const outer = await import("./outer.mjs");
  console.log("a", String(far.v), String(outer.v));
});
