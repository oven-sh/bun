typeof module === "undefined" || typeof exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared13 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or", typeOfThis(), storeToUndeclaredName());
