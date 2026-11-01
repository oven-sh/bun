function readModule() {
  module;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared97 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-a-function", typeOfThis(), storeToUndeclaredName());
