[[module][0]][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared90 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-of-an-item-is-module", typeOfThis(), storeToUndeclaredName());
