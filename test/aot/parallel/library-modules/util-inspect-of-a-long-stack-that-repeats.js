// util.inspect of an error whose stack is a recursion of 20,000 lines prints the cycle once, and what it does for each line does not grow with the stack: one,
// two and three functions that call one another, two functions with a line that stands on both sides of the recursion, and two with lines in front of it.
// It builds tables of the blocks of 1, 2, 4 .. lines only as far as such a stack needs them: 6 typed arrays for one function, 11 for each of the others.
// Under each recursion stand 70 callers, so that each of those arrays is long enough to be made by a call into the run time, which is what is counted.
// Not bounded here: a recursion that the stack holds twice. Its tables grow with the depth of the recursion.
// COUNT: branches <= 4400000
// COUNT: operation:operationAOTNewTypedArray <= 50
const util = require("node:util");

const lines = 20_000;
const at = name => `    at ${name} (file.js:1:1)`;
const recursion = names => Array.from({ length: lines }, (_, i) => at(names[i % names.length]));
const callers = Array.from({ length: 70 }, (_, i) => at(`caller${i}`));
// The first lines that util.inspect prints for a stack above its callers, and how many lines in all.
function shown(frames) {
  const error = new Error("m");
  error.stack = ["Error: m", ...frames, ...callers].join("\n");
  const printed = util.inspect(error).split("\n");
  return `${printed.slice(0, 7).join("\n")}\n.. ${printed.length} lines`;
}

console.log(shown(recursion(["a"])));
console.log(shown(recursion(["a", "b"])));
console.log(shown(recursion(["a", "b", "c"])));
console.log(shown([at("map"), ...recursion(["a", "b"]), at("map")]));
console.log(shown([at("a"), at("x"), ...recursion(["a", "b"])]));
