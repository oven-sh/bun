if (!typeof module) Object();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared116 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-if-not-typeof", typeOfThis(), storeToUndeclaredName());
