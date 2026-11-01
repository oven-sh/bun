var x = 1,
  y = {};
if (typeof x == null) {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared352 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-compared-with-null", typeOfThis(), storeToUndeclaredName());
