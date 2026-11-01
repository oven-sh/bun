var x = 1,
  y = {};
var v = "z" in y ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared320 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-or-else-module", typeOfThis(), storeToUndeclaredName());
