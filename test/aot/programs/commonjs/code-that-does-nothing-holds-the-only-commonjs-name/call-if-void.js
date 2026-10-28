if (void typeof module) Object();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared115 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("call-if-void", typeOfThis(), storeToUndeclaredName());
