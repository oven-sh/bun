var maybe = Number("0");
var kept = [maybe || 1][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared144 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or-item-nullish", typeOfThis(), storeToUndeclaredName());
