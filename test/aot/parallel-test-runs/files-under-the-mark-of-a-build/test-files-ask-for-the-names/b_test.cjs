// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
const runner = require("bun:test");
const seenAtLoad = [typeof jest, typeof expect, typeof describe, typeof vi, typeof test, typeof beforeEach].join(" ");
runner.test("under the mark of commonjs", () => {
  console.log(seenAtLoad);
  console.log([typeof jest, typeof expect, typeof describe, typeof vi, typeof test, typeof beforeEach].join(" "));
});
})
