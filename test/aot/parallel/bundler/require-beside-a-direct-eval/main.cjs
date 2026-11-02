const hidden = eval("require");
const lib = require("./lib.cjs");
function load(text) {
  eval(text);
  return require("./other.cjs");
}
console.log(typeof hidden, lib.name, load("").name);
