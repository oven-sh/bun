// util.inspect of an error whose stack has 20,000 lines tests each line a bounded number of times where the stack only nearly repeats: a function with a
// line of its own behind each call, a visitor that calls one of three handlers, and 10,000 lines twice but for the last one. It builds no table of blocks
// that are longer than the longest block that stands twice: none for the first stack. The functions of Node.js for the same step compare the lines once
// for every later copy of a line: compiled as the text of a program, 150 million to 1,100 million branches a stack.
// Under each stack stand 70 callers, so that each typed array is long enough to be made by a call into the run time, which is what is counted.
// COUNT: branches <= 8800000
// COUNT: operation:operationAOTNewTypedArray <= 102
const util = require("node:util");

const lines = 20_000;
const at = name => `    at ${name} (file.js:1:1)`;
const stackOf = line => Array.from({ length: lines }, (_, i) => at(line(i)));
const callers = Array.from({ length: 70 }, (_, i) => at(`caller${i}`));
let seed = 42;
function handler() {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return "handler" + ((seed >> 16) % 3);
}
// What is left of a stack above its callers: how many lines util.inspect prints, and how many of those stand for lines that it hides.
function left(frames) {
  const error = new Error("m");
  error.stack = ["Error: m", ...frames, ...callers].join("\n");
  const printed = util.inspect(error).split("\n");
  return `${printed.length - 1} lines, ${printed.filter(line => line.startsWith("    ... collapsed ")).length} for hidden lines`;
}

console.log(left(stackOf(i => (i % 2 ? `own${i}` : "a"))));
console.log(left(stackOf(i => (i % 2 ? handler() : "visit"))));
console.log(left(stackOf(i => (i === lines - 1 ? "last" : `line${i % (lines / 2)}`))));
