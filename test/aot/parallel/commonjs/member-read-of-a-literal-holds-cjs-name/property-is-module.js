({ a: module }).a;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared82 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-is-module", typeOfThis(), storeToUndeclaredName());
