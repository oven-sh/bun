var kept = [null][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared143 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("null-item-nullish", typeOfThis(), storeToUndeclaredName());
