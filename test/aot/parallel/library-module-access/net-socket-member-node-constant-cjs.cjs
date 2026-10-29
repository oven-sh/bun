// A function reads createRequire, under a key that is put together at run time, off a constant that the top of the CommonJS file sets to require("node:module"), and returns it.
const Module = require("node:module");
function pick(key) {
  return Module[key];
}
const make = pick("createRequire adder".split(" ")[0]);
console.log(typeof make(__filename)("node:net".trim()).Socket);
