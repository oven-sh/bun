if ([0][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared12 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("only-item", typeOfThis(), storeToUndeclaredName());
