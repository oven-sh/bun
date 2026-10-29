function never() { typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared46 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-a-function", typeOfThis(), storeToUndeclaredName());
