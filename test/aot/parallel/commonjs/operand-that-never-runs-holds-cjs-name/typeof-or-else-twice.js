var x = 1,
  y = {};
var v = typeof x ?? y ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared329 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-or-else-twice", typeOfThis(), storeToUndeclaredName());
