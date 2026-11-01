if ([[]][0] === null) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared141 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("array-item-compared-to-null", typeOfThis(), storeToUndeclaredName());
