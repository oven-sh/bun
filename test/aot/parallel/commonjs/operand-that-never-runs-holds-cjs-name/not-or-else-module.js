var x = 1,
  y = {};
var v = !x ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared314 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-or-else-module", typeOfThis(), storeToUndeclaredName());
