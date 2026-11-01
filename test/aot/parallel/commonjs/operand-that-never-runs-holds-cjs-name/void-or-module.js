var x = 1,
  y = {};
var v = void x || module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared339 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("void-or-module", typeOfThis(), storeToUndeclaredName());
