void require;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared70 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("require-by-itself", typeOfThis(), storeToUndeclaredName());
