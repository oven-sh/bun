// The text of a direct eval names `arguments` at the top of a CommonJS file and in an arrow function there: it is the wrapper function's arguments object, mapped to the five parameters in sloppy code. In a function it is that function's.
console.log(eval("arguments.length"), eval("arguments[0] === exports"), eval("arguments[2] === module"));
const inArrow = (text) => eval(text);
console.log(inArrow("arguments.length"), inArrow("arguments[1] === require"));
function inFunction(text) { return eval(text); }
console.log(inFunction("arguments.length"), inFunction("arguments[0]"), inFunction("typeof exports"));

const firstExports = exports;
eval("arguments[0] = 'stored by the text'");
console.log(exports);
exports = "stored by the file";
console.log(eval("arguments[0]"), inArrow("exports"), inFunction("exports"));
inFunction("exports = 'stored in a function'");
console.log(eval("arguments[0]"));
exports = firstExports;

eval("arguments = ['replaced']");
console.log(eval("arguments.length"), inArrow("arguments[0]"));
eval("var arguments = 'declared by the text'");
console.log(eval("arguments"));
require("./strict.cjs");
