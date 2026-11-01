if (typeof { a: class {} }.a === "string") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared139 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-a-property-that-is-a-class", typeOfThis(), storeToUndeclaredName());
