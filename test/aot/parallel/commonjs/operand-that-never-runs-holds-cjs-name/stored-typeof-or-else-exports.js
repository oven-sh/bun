var x = 1,
  y = {};
var v = typeof x ?? exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared306 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-or-else-exports", typeOfThis(), storeToUndeclaredName());
