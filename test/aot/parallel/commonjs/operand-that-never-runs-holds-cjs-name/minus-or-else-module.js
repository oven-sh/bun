var x = 1,
  y = {};
var v = -x ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared315 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("minus-or-else-module", typeOfThis(), storeToUndeclaredName());
