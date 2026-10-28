if (typeof module) Object();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared117 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-if-typeof", typeOfThis(), storeToUndeclaredName());
