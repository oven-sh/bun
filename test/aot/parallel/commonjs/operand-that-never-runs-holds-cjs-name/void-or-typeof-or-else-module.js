var x = 1,
  y = {};
var v = (void x || typeof x) ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared362 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("void-or-typeof-or-else-module", typeOfThis(), storeToUndeclaredName());
