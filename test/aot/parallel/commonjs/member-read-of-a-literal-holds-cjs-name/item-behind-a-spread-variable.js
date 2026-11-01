var list = [];
if ([...list, 0][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared116 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-behind-a-spread-variable", typeOfThis(), storeToUndeclaredName());
