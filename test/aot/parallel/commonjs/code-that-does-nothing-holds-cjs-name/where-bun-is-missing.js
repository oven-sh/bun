if (typeof Bun === "undefined") { void typeof module; }
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared32 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
