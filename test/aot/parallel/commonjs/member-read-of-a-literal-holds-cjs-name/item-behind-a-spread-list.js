if ([...[1], 0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared15 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-behind-a-spread-list", typeOfThis(), storeToUndeclaredName());
