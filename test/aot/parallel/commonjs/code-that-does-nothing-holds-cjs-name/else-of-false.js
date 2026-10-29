if (false) console.log("never"); else typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared28 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-of-false", typeOfThis(), storeToUndeclaredName());
