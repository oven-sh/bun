var lib;
try {
  console.log(lib.name);
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(lib.name);
