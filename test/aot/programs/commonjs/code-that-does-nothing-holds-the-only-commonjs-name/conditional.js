typeof module === "object" ? typeof exports : typeof require;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared15 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional", typeOfThis(), storeToUndeclaredName());
