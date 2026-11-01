var x = 1,
  y = {};
if (!typeof Bun) {
  module.id;
} else {
  y.a = 1;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared334 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-not-typeof-bun-module", typeOfThis(), storeToUndeclaredName());
