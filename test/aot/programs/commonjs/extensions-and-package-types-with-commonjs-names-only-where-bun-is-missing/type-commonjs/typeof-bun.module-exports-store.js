if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared105 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-commonjs/typeof-bun module-exports-store js", typeOfThis(), storeToUndeclaredName());
