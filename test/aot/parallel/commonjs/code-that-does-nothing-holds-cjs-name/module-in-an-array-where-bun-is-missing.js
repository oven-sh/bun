typeof Bun === "undefined" && [module];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared100 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-in-an-array-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
