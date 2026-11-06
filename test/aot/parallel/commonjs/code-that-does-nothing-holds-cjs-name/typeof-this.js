typeof this;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared7 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-this", typeOfThis(), storeToUndeclaredName());
