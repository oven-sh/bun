var kept = [1][0] ?? module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared45 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("member-nullish", typeOfThis(), storeToUndeclaredName());
