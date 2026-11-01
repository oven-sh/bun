if ([1, 0][2 - 1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared18 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-at-a-computed-index", typeOfThis(), storeToUndeclaredName());
