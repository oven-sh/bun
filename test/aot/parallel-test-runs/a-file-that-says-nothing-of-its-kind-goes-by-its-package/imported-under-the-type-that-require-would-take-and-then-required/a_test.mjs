import { test } from "bun:test";
test("t", async () => {
  await import("./imports.mjs");
  console.log(Object.prototype.toString.call(require("./commonjs/plain.unknown")));
  console.log(Object.prototype.toString.call(require("./module/requires.unknown")));
});
