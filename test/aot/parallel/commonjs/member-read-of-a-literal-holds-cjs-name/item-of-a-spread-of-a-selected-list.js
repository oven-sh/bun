if ([...(1 ? [1, 0] : [])][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared157 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-of-a-spread-of-a-selected-list", typeOfThis(), storeToUndeclaredName());
