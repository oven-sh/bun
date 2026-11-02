// `--define ARGS=arguments` names what a CommonJS file is called with: a function stored as the second is `require`, and `lib` is what it returns.
// Flags: --define ARGS=arguments
ARGS[1] = function (name) {
  return { value: "the object that the stored function answers for " + name };
};
const lib = require("./lib.cjs");
console.log(lib.value);
