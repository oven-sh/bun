import { test } from "bun:test";
test("t", async () => {
  console.log(Object.prototype.toString.call(require("./commonjs/plain.es6")));
  console.log(Object.prototype.toString.call(require("./module/requires.es6")));
});
