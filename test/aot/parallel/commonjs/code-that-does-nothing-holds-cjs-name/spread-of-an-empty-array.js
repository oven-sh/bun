[typeof module, ...[]];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared120 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("spread-of-an-empty-array", typeOfThis(), storeToUndeclaredName());
