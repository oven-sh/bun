typeof module == "object";
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared10 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("compared-loosely", typeOfThis(), storeToUndeclaredName());
