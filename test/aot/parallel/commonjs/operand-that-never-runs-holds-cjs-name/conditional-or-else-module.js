var x = 1,
  y = {};
var v = (x ? 1 : 2) ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared348 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional-or-else-module", typeOfThis(), storeToUndeclaredName());
