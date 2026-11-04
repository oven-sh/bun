var x = 1,
  y = {};
typeof Bun ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared300 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun-or-else-module", typeOfThis(), storeToUndeclaredName());
