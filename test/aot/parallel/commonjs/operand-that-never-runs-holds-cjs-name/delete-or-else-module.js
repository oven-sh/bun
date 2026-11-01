var x = 1,
  y = {};
var v = delete y.z ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared317 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("delete-or-else-module", typeOfThis(), storeToUndeclaredName());
