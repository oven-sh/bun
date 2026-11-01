typeof Bun !== "undefined" || typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared38 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or-where-bun-is-there", typeOfThis(), storeToUndeclaredName());
