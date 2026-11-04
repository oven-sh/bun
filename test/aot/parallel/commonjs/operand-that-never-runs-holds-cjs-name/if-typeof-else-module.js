var x = 1,
  y = {};
if (typeof x) {
  y.a = 1;
} else {
  module.id;
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared332 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("if-typeof-else-module", typeOfThis(), storeToUndeclaredName());
