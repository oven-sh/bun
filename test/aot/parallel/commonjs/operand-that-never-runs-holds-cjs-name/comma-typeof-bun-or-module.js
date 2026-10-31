var x = 1,
  y = {};
var v = (y, typeof Bun) || module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared324 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("comma-typeof-bun-or-module", typeOfThis(), storeToUndeclaredName());
