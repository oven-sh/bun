void typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared1 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("void-typeof-module", typeOfThis(), storeToUndeclaredName());
