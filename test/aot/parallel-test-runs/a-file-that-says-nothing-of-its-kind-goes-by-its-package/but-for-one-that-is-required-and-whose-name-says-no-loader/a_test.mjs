import { test } from "bun:test";
test("t", async () => {
  console.log(Object.prototype.toString.call(require("./commonjs/plain.unknown")));
  console.log(Object.prototype.toString.call(require("./module/requires.unknown")));
  console.log(Object.prototype.toString.call(require("./commonjs/plain")));
  console.log(Object.prototype.toString.call(require("./module/requires")));
});
