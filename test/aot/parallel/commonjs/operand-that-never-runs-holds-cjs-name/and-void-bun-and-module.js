var x = 1,
  y = {};
var v = y && void Bun && module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared326 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and-void-bun-and-module", typeOfThis(), storeToUndeclaredName());
