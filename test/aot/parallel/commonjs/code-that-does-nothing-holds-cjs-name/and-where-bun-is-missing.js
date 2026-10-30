typeof Bun === "undefined" && typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared37 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
