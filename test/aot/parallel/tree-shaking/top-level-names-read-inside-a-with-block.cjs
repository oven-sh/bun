// Inside `with` a name is looked for in the object first and then outside: the constants outside stay, also one that is declared behind the function that reads it.
const outer = "outer";
const other = { inner: "inner" };
const scope = { unrelated: 1 };
with (scope) {
  console.log(outer, other.inner);
}
function late() {
  with (scope) { return typeof lateConstant + lateConstant; }
}
const lateConstant = "late";
console.log(late());
