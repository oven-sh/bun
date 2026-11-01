var kept = [{}][0] || module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared68 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object-item-or", typeOfThis(), storeToUndeclaredName());
