var x = 1,
  y = {};
var v = `a${x}` ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared347 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("template-or-else-module", typeOfThis(), storeToUndeclaredName());
