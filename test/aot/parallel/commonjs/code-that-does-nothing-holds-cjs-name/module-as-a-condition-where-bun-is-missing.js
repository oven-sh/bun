if (typeof Bun === "undefined") {
  module && 1;
  module ? 1 : 2;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared103 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-as-a-condition-where-bun-is-missing", typeOfThis(), storeToUndeclaredName());
