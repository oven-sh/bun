// util.inspect of an error whose stack is a recursion of 20,000 lines prints the cycle once: one, two and three functions that call one another. What it does
// for each line does not grow with the stack, and it builds tables of the blocks of 1, 2, 4 .. lines only as far as the cycle needs them: at most 11 typed
// arrays a stack. The functions of Node.js for the same step compare the lines once for every later copy of a line.
// COUNT: branches <= 4000000
// COUNT: operation:operationAOTNewTypedArray <= 33
const util = require("node:util");

const lines = 20_000;
const at = name => `    at ${name} (file.js:1:1)`;
function errorWithFrames(frames) {
  const error = new Error("m");
  error.stack = ["Error: m", ...frames].join("\n");
  return error;
}
const stackOf = names => [...Array.from({ length: lines }, (_, i) => at(names[i % names.length])), at("main")];

console.log(util.inspect(errorWithFrames(stackOf(["a"]))));
console.log(util.inspect(errorWithFrames(stackOf(["a", "b"]))));
console.log(util.inspect(errorWithFrames(stackOf(["a", "b", "c"]))));
