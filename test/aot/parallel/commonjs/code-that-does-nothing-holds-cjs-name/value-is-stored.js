const stored = typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared44 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("value-is-stored", typeOfThis(), storeToUndeclaredName());
