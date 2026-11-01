if ([1, 0][2]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared107 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("index-out-of-range", typeOfThis(), storeToUndeclaredName());
