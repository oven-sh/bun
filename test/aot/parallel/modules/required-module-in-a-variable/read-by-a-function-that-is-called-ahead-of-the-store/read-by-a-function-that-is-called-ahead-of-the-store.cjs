var lib;
function name() {
  return lib.name;
}
try {
  console.log(name());
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(name(), lib.next(), lib.next(), lib.count);
