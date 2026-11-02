-typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared60 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("negated", typeOfThis(), storeToUndeclaredName());
