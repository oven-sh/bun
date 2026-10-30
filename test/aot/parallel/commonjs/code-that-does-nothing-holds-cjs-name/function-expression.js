(function () { return module; });
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared21 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("function-expression", typeOfThis(), storeToUndeclaredName());
