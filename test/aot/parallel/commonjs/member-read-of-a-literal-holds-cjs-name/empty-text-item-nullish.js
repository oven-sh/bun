var kept = [""][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared67 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("empty-text-item-nullish", typeOfThis(), storeToUndeclaredName());
