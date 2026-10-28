if (false) {
  module.exports = { a: 1 };
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared24 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false module-exports-store", typeOfThis(), storeToUndeclaredName());
