!typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared2 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-typeof-module", typeOfThis(), storeToUndeclaredName());
