if (false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared107 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("type-commonjs/false module-exports-store js", typeOfThis(), storeToUndeclaredName());
