if ("ab"[2]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared119 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-out-of-range", typeOfThis(), storeToUndeclaredName());
