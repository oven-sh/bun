import { test } from "bun:test";
test("t", async () => {
  console.log(Object.prototype.toString.call(require("./commonjs/plain.JS")));
  console.log(Object.prototype.toString.call(require("./module/requires.JS")));
});
