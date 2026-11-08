import { test } from "bun:test";
test("b", async () => {
  const dep = await import("./dep.mjs");
  console.log("| b " + dep.kind + " " + dep.extra);
});
