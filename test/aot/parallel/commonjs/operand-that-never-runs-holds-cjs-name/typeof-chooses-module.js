var x = 1,
  y = {};
var v = typeof x ? module.id : 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared341 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-chooses-module", typeOfThis(), storeToUndeclaredName());
