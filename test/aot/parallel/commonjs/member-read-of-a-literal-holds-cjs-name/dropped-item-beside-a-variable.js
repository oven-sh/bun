var kept = [module, 0][1];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared131 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("dropped-item-beside-a-variable", typeOfThis(), storeToUndeclaredName());
