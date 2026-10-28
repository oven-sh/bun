if (typeof Bun !== "undefined" && false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared27 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bun-and-false module-exports-store", typeOfThis(), storeToUndeclaredName());
