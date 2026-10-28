if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared85 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun module-exports-store mjs", typeOfThis(), storeToUndeclaredName());
