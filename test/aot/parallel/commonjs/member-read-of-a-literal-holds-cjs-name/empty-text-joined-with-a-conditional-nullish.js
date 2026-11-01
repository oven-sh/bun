var b;
var kept = ("" + (b ? "x" : "y")) ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared164 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("empty-text-joined-with-a-conditional-nullish", typeOfThis(), storeToUndeclaredName());
