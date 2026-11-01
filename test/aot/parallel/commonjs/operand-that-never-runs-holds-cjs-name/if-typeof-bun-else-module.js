var x = 1,
  y = {};
if (typeof Bun) {
  y.a = 1;
} else {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared331 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-typeof-bun-else-module", typeOfThis(), storeToUndeclaredName());
