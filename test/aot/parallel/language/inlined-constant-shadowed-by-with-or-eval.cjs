// A `with` object and a `var` that evaluated text declares hide a leading `const count = 1`, as the language says. `bun run` prints the value in place of each read, and so did executables before: `with 1 outer number`, `eval 1`.
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
/* Output:
with 2 inner number
eval 3
parameter 4
declared later 5
*/
