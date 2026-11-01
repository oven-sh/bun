const at = 1;
if ([1, 0][at]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared19 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-at-a-constant", typeOfThis(), storeToUndeclaredName());
