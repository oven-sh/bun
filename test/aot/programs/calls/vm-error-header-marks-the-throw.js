// The header that node:vm puts in front of the stack of an error that leaves a script marks where the script threw it, wherever the error was made: in the script, in compiled code, long before the script ran, or in a host function that the script called.
const vm = require("node:vm");

function make(message) {
  return new Error(message);
}
function makeDeeper(depth, message) {
  return depth ? makeDeeper(depth - 1, message) : make(message);
}
const kept = makeDeeper(3, "made before the script ran");
const seen = [];

function headerOf(text) {
  try {
    vm.runInNewContext(text, { make, makeDeeper, kept, seen }, { filename: "text.js" });
    return "did not throw";
  } catch (error) {
    const stack = String(error.stack);
    const start = stack.indexOf(error.name + ": " + error.message);
    return start < 0 ? "the stack does not hold the message" : JSON.stringify(stack.slice(0, start));
  }
}
function headerUnderFrames(depth, text) {
  const header = depth ? headerUnderFrames(depth - 1, text) : headerOf(text);
  seen.push(depth);
  return header;
}

const texts = [
  `throw new Error("made where it is thrown")`,
  `  \n    throw new Error("further down and to the right")`,
  `function create() { return new Error("made by a function of the script") }\nconst error = create();\n\nthrow error;`,
  `throw make("made by compiled code")`,
  `const error = makeDeeper(4, "made under several compiled frames");\n  throw error;`,
  `\nthrow kept;`,
  `JSON.parse("{")`,
  `function parse() { return JSON.parse("{") }\ntry { parse() } finally { seen.push("finally") }`,
  `try { JSON.parse("{") } catch (error) { seen.push(typeof error.stack);\n  throw error }`,
  `const error = make("read before it is thrown"); seen.push(typeof error.stack);\nthrow error;`,
  `null.property`,
];
for (const text of texts) {
  console.log(headerOf(text));
  console.log(headerUnderFrames(5, text === texts[5] ? `\nthrow make("in place of the error that has its header")` : text));
}
console.log(seen.join());
