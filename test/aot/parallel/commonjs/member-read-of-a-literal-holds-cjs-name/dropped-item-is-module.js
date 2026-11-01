[module, 0][1];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared81 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("dropped-item-is-module", typeOfThis(), storeToUndeclaredName());
