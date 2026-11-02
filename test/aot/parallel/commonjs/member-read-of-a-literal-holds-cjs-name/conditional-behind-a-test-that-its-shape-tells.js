var b;
var kept = (typeof b && 0 ? 1 : 2) === 2 || module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared167 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional-behind-a-test-that-its-shape-tells", typeOfThis(), storeToUndeclaredName());
