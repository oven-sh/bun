var x = 1,
  y = {};
var v = typeof Bun ? 1 : module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared312 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-bun-chooses", typeOfThis(), storeToUndeclaredName());
