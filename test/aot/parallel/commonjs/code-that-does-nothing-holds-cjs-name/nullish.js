typeof module ?? typeof exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared14 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nullish", typeOfThis(), storeToUndeclaredName());
