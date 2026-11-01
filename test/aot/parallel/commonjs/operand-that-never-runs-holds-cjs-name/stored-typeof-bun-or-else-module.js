var x = 1,
  y = {};
var v = typeof Bun ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared305 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-bun-or-else-module", typeOfThis(), storeToUndeclaredName());
