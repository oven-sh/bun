var addend = Number("1");
var kept = [addend + 1][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared66 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("sum-item-nullish", typeOfThis(), storeToUndeclaredName());
