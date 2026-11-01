if ([, 1][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared13 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("hole", typeOfThis(), storeToUndeclaredName());
