let lib;
const name = () => lib.name;
try {
  console.log(name());
} catch (error) {
  console.log(error.name);
}
lib = require("./lib.cjs");
console.log(name());
