var x = 1,
  y = {};
var v = typeof x && module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared338 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-and-module", typeOfThis(), storeToUndeclaredName());
