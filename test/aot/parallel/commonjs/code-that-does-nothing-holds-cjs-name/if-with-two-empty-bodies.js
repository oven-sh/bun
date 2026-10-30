if (typeof module === "object") {} else {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared25 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-with-two-empty-bodies", typeOfThis(), storeToUndeclaredName());
