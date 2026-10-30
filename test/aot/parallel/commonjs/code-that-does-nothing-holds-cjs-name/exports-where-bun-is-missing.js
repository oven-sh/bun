if (typeof Bun === "undefined") exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared99 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("exports-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
