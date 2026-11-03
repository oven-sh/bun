var x = 1,
  y = {};
var v = typeof x ?? __filename;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared308 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("stored-typeof-or-else-filename", typeOfThis(), storeToUndeclaredName());
