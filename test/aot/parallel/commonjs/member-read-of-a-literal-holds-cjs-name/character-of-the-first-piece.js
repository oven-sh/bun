if (("ab" + "cd")[1] === "x") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared37 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-of-the-first-piece", typeOfThis(), storeToUndeclaredName());
