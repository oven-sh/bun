if ((-1, [0])[0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared74 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-a-negative-number-and-a-comma", typeOfThis(), storeToUndeclaredName());
