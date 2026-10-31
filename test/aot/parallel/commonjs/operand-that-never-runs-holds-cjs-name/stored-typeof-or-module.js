var x = 1,
  y = {};
var v = typeof x || module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared310 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-or-module", typeOfThis(), storeToUndeclaredName());
