var kept = [{}][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared63 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object-item-nullish", typeOfThis(), storeToUndeclaredName());
