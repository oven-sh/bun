typeof exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared4 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-exports", typeOfThis(), storeToUndeclaredName());
