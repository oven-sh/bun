if (typeof Bun === "undefined") {
  module;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared98 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
