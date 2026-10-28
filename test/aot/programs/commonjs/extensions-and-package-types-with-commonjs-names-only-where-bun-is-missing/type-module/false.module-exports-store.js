if (false) {
  module.exports = { a: 1 };
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
console.log("type-module/false module-exports-store js", typeOfThis(), storeToUndeclaredName());
