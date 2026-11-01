[module][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared80 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("only-item-is-module", typeOfThis(), storeToUndeclaredName());
