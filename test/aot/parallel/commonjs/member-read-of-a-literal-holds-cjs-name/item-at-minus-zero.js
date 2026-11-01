if ([0, 1][-0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared20 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-at-minus-zero", typeOfThis(), storeToUndeclaredName());
