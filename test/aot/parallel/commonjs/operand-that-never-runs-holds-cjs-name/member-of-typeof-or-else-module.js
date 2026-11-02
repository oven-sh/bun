var x = 1,
  y = {};
(typeof Bun ?? module).id;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared304 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("member-of-typeof-or-else-module", typeOfThis(), storeToUndeclaredName());
