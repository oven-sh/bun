if ([].length) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared118 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-an-array", typeOfThis(), storeToUndeclaredName());
