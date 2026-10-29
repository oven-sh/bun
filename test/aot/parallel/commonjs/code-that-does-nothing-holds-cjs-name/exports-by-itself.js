exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared81 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("exports-by-itself", typeOfThis(), storeToUndeclaredName());
