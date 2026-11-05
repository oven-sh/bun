var x = 1,
  y = {};
var v = x + 1 ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared318 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("sum-or-else-module", typeOfThis(), storeToUndeclaredName());
