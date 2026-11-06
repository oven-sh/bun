var x = 1,
  y = {};
var v = void Bun ? module.id : 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared313 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-void-bun-chooses", typeOfThis(), storeToUndeclaredName());
