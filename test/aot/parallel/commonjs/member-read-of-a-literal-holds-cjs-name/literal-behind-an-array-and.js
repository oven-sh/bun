if (([] && [0])[0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared129 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-an-array-and", typeOfThis(), storeToUndeclaredName());
