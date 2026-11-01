if ([[1, 0], 5][0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared16 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-of-an-item", typeOfThis(), storeToUndeclaredName());
