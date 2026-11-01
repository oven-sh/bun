var x = 1,
  y = {};
var v = typeof Bun || y || module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared327 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-bun-or-a-variable-or-module", typeOfThis(), storeToUndeclaredName());
