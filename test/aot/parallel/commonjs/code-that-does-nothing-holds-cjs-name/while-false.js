while (false) { typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared68 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while-false", typeOfThis(), storeToUndeclaredName());
