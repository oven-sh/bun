if ((1 + 2 + "a")[0] === "x") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared38 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-of-a-number-in-front-of-a-text", typeOfThis(), storeToUndeclaredName());
