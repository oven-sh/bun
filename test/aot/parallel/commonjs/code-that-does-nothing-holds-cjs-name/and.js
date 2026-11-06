typeof module !== "undefined" && typeof exports !== "undefined";
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared12 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and", typeOfThis(), storeToUndeclaredName());
