if ([...[]][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared117 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-that-is-a-spread-of-nothing", typeOfThis(), storeToUndeclaredName());
