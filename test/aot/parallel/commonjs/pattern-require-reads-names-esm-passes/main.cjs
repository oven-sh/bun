// `const { a } = require("./index.mjs")`, where the ES module has `export { a } from "./lib.cjs"`: the pattern reads what the CommonJS file exports, as a member access does. The output is that of plain Bun.
const { go, n, lib, keys, own, missing = "a default" } = require("./index.mjs");
console.log(typeof go, go(), n, JSON.stringify(lib), keys, own, missing);

const whole = require("./index.mjs");
console.log(whole.go === go, whole.n === n, whole.lib === lib);

function later() {
  const { go: again, renamed } = require("./index.mjs");
  return [again === go, renamed];
}
console.log(later().join());
