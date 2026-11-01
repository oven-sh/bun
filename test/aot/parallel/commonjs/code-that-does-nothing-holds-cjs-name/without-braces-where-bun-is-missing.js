if (typeof Bun === "undefined") typeof module;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared34 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("without-braces-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
