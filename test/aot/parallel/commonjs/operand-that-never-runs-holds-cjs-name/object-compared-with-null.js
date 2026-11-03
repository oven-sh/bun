var x = 1,
  y = {};
if ({} == null) {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared350 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("object-compared-with-null", typeOfThis(), storeToUndeclaredName());
