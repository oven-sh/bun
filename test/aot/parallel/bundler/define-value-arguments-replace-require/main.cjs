// A `--define` whose value is `arguments` names, outside every function of a CommonJS file, the arguments that the file itself is called with: a store to the second of them replaces `require`.
// Flags: --define ARGS=arguments
ARGS[1] = function (name) {
  return "the function that the file stored: " + name;
};
console.log(require("./lib.cjs"));
