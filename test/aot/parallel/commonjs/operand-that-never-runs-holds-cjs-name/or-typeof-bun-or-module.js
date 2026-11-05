var x = 1,
  y = {};
var v = y || typeof Bun || module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared325 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or-typeof-bun-or-module", typeOfThis(), storeToUndeclaredName());
