if ("é".length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared28 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-text-outside-ascii", typeOfThis(), storeToUndeclaredName());
