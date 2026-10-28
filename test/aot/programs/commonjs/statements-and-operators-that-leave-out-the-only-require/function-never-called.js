function f() {
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared77 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("function-never-called", typeOfThis(), storeToUndeclaredName());
