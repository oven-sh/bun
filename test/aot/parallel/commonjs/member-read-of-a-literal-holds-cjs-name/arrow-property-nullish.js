var kept = { a: () => 0 }.a ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared64 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("arrow-property-nullish", typeOfThis(), storeToUndeclaredName());
