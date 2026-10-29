if (typeof Bun === "undefined") {
  [...[module]];
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared121 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("spread-of-an-array-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
