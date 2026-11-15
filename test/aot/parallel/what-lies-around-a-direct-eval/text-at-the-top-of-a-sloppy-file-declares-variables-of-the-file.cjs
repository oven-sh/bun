// Sloppy text at the top of a CommonJS file declares variables of the file: over the file's own names where it has them, beside them where it has not.
// Such a file keeps its names and those variables in one scope, so every direct eval of it lists the names itself.
var old = "file";
function declared() {
  return "file";
}
function looks(text) {
  return eval(text);
}
function alsoLooks(text) {
  return eval(text);
}

console.log(eval("var old = 'top'; old"), old, looks("old"));
console.log(eval("var atTop = 'top'; atTop"), atTop, looks("atTop"), alsoLooks("atTop = 'stored'; atTop"), atTop);
console.log(delete atTop, typeof atTop, looks("typeof atTop"));
console.log(eval("function declared() { return 'top'; } declared()"), declared(), alsoLooks("declared()"));
console.log(looks("var old = 'text'; old"), old, alsoLooks("(old)"));
