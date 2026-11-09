// Sloppy text in a function declares variables of the function, and they hide the names of the file. The file has no text at its top, so its names are listed once
// (text-at-the-top-of-a-sloppy-file-declares-variables-of-the-file.cjs is the other road).
var old = "file";
let plain = "file";
function declared() {
  return "file";
}

function declares(text) {
  const answer = eval(text);
  return [answer, typeof old, old, typeof fresh === "undefined" ? "no fresh" : fresh];
}
console.log(declares("var old = 'text'; old"), old);
console.log(declares("var fresh = 'text'; fresh"), typeof fresh);
console.log(declares("function declared() { return 'text'; } declared()"), declared());
console.log(declares("old = 'stored'; old"), old);
function twice() {
  eval("var old = 1");
  eval("old += 1");
  return eval("old");
}
console.log(twice(), old);
function conflicts() {
  try {
    return eval("var plain = 1; plain");
  } catch (error) {
    return error.constructor === SyntaxError;
  }
}
console.log(conflicts(), plain);
function names() {
  return eval(
    "[typeof module, typeof exports, typeof require, typeof __filename, typeof __dirname, module.exports === exports]",
  );
}
console.log(names());
function hides(old, text) {
  return eval(text);
}
console.log(hides("parameter", "old = 'stored again'; old"), old, hides("parameter", "typeof old + delete old"));
console.log(
  declares("delete old")[0],
  declares("delete plain")[0],
  declares("typeof missing")[0],
  declares("typeof this")[0],
);
console.log(
  declares("undeclared = 'global'; typeof undeclared")[0],
  names.call(null).length,
  typeof undeclared,
  delete globalThis.undeclared,
);
