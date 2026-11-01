if (typeof module === "object") typeof exports; else { typeof require; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared26 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-with-unused-values", typeOfThis(), storeToUndeclaredName());
