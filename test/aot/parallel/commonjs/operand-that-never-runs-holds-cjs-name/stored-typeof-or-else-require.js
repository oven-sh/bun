var x = 1,
  y = {};
var v = typeof x ?? require("node:fs");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared307 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-or-else-require", typeOfThis(), storeToUndeclaredName());
