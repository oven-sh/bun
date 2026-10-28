typeof Bun === "undefined" ? typeof module : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared39 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
