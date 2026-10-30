var lib;
if (process.argv.length > 100) {
  lib = require("./other.cjs");
} else {
  lib = require("./lib.cjs");
}
console.log(lib.name);
