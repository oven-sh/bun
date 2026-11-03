var x = 1,
  y = {};
var v = (void String(1) || typeof x) ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared366 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("void-of-a-call-or-typeof-or-else-module", typeOfThis(), storeToUndeclaredName());
