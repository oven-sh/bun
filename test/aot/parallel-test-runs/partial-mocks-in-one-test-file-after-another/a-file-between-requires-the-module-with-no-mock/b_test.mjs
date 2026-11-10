import { test } from "bun:test";
test("b", () => {
  const dep = import.meta.require("./dep.mjs");
  console.log("| b " + dep.kind + " " + dep.extra);
});
