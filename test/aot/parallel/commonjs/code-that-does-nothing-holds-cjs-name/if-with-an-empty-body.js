if (typeof module === "object") {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared24 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-with-an-empty-body", typeOfThis(), storeToUndeclaredName());
