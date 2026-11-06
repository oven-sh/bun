var x = 1,
  y = {};
if (!typeof x === true) {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared360 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-typeof-compared", typeOfThis(), storeToUndeclaredName());
