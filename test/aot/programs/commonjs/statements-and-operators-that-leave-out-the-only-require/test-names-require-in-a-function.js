function f() {
  if (typeof require === "undefined") console.log(1);
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared79 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-names-require-in-a-function", typeOfThis(), storeToUndeclaredName());
