typeof [module][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared84 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-the-item-that-is-module", typeOfThis(), storeToUndeclaredName());
