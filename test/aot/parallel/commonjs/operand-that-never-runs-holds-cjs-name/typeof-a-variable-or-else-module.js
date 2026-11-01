var x = 1,
  y = {};
typeof x ?? module.id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared301 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-variable-or-else-module", typeOfThis(), storeToUndeclaredName());
