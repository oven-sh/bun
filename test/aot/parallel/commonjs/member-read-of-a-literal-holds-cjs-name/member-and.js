var kept = [0][0] && module.exports;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared43 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("member-and", typeOfThis(), storeToUndeclaredName());
