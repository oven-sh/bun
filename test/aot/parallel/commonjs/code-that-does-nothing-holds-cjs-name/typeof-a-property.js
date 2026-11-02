typeof module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared59 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-property", typeOfThis(), storeToUndeclaredName());
