typeof module;
module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared79 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("another-statement-uses-module", typeOfThis(), storeToUndeclaredName());
