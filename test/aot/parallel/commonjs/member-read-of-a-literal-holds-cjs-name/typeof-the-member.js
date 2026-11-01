if (typeof { a: 1 }.a === "string") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared41 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("typeof-the-member", typeOfThis(), storeToUndeclaredName());
