var x = 1,
  y = {};
var v = typeof x ?? (() => module.id);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared336 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("in-an-arrow-function-that-never-exists", typeOfThis(), storeToUndeclaredName());
