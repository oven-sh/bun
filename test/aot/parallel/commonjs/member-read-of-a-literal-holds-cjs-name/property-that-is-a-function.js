if ({ b: () => {} }.b) {} else module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared7 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-that-is-a-function", typeOfThis(), storeToUndeclaredName());
