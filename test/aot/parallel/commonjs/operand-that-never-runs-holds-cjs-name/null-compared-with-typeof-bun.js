var x = 1,
  y = {};
if (null == typeof Bun) {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared354 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("null-compared-with-typeof-bun", typeOfThis(), storeToUndeclaredName());
