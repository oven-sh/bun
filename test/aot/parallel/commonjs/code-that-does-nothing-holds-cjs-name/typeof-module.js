typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared0 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-module", typeOfThis(), storeToUndeclaredName());
