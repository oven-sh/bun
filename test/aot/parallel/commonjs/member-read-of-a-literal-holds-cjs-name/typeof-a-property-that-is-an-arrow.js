if (typeof { a: () => 0 }.a === "string") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared60 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-property-that-is-an-arrow", typeOfThis(), storeToUndeclaredName());
