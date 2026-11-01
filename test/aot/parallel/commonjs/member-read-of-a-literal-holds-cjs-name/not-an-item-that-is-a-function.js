if (![function () {}][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared62 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-an-item-that-is-a-function", typeOfThis(), storeToUndeclaredName());
