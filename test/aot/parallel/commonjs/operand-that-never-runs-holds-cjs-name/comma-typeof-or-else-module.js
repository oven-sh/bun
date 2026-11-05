var x = 1,
  y = {};
var v = (x, typeof x) ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared323 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("comma-typeof-or-else-module", typeOfThis(), storeToUndeclaredName());
