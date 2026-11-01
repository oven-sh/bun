if ([module, 0][1]) {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared85 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-in-an-empty-if", typeOfThis(), storeToUndeclaredName());
