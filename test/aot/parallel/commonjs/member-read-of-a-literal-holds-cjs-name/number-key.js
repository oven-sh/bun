if ({ 1: 0 }[1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared99 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("number-key", typeOfThis(), storeToUndeclaredName());
