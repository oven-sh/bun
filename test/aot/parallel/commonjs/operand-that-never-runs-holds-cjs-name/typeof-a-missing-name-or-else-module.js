var x = 1,
  y = {};
typeof nowhere ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared302 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-missing-name-or-else-module", typeOfThis(), storeToUndeclaredName());
