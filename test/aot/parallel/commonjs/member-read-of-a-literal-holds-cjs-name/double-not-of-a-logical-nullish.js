var b;
var kept = !!(!b || !b) ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared162 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("double-not-of-a-logical-nullish", typeOfThis(), storeToUndeclaredName());
