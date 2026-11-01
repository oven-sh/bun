// `bun run` prints the value of a leading `const count = 1` in place of each read, so neither a `with` object nor a `var` that eval declares shadows it.
const count = 1;
const label = "outer";
with ({ count: 2, label: "inner" }) {
  console.log("with", count, label, typeof count);
}
function readBehindEval() {
  eval("var count = 3");
  return count;
}
console.log("eval", readBehindEval());
function readParameter(count) {
  return count;
}
console.log("parameter", readParameter(4));
function readDeclaredLater() {
  with ({ declaredLater: 5 }) {
    return declaredLater;
  }
}
const declaredLater = 6;
console.log("declared later", readDeclaredLater());
