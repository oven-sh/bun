if (typeof neverDefinedAnywhere !== "undefined") {
  module.exports = { a: 1 };
}
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
console.log("unknown-global module-exports-store", typeOfThis(), storeToUndeclaredName());
