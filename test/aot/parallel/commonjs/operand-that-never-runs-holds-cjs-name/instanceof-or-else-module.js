var x = 1,
  y = {};
var v = y instanceof Object ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared321 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("instanceof-or-else-module", typeOfThis(), storeToUndeclaredName());
