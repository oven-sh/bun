var x = 1,
  y = {};
var v = !typeof Bun && module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared330 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-typeof-bun-and-module", typeOfThis(), storeToUndeclaredName());
