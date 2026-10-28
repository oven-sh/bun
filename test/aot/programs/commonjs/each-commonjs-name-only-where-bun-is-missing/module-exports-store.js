if (typeof Bun === "undefined") {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared36 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("module-exports-store", typeOfThis(), storeToUndeclaredName());
