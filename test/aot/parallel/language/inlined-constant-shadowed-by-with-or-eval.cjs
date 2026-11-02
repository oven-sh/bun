// `bun run` prints the value of a leading `const count = 1` in place of each read, so a `var` that eval declares does not shadow it. A read in the body of a `with` is left as a read: the object shadows the constant.
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
