var kept = [[]][0] && module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared146 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("array-item-and", typeOfThis(), storeToUndeclaredName());
