var lib;
function load() {
  lib = require("./lib.cjs");
}
console.log(typeof lib);
load();
console.log(lib.name);
