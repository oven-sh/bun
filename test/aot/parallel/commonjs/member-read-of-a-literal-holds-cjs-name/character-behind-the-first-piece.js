if (("ab" + "cd")[2] === "x") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared121 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-behind-the-first-piece", typeOfThis(), storeToUndeclaredName());
