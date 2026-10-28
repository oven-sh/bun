if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared101 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-module/typeof-bun module-exports-store js", typeOfThis(), storeToUndeclaredName());
