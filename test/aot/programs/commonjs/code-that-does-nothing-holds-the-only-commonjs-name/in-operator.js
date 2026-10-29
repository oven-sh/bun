typeof module in {};
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared61 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-operator", typeOfThis(), storeToUndeclaredName());
