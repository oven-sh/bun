// Strict functions whose text is evaluated return `new Error()` and `Error()`. Prints the names of the frames.
function frames(error) {
  const lines = error.stack.split("\n").slice(1, 4);
  return lines.map(line => /at (\S+) \(/.exec(line)?.[1] ?? "-").join(" ");
}
const constructs = (0, eval)('(function constructs() { "use strict"; return new Error("a"); })');
const calls = (0, eval)('(function calls() { "use strict"; return Error("b"); })');
const direct = eval('(function direct() { return new TypeError("c"); })');
const made = new Function('"use strict"; return new RangeError("d");');
console.log(frames(constructs()));
console.log(frames(calls()));
console.log(frames(direct()));
console.log(frames(made()));
