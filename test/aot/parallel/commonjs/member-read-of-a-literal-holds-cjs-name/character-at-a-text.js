if ("ab"["0"] === "b") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared122 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-at-a-text", typeOfThis(), storeToUndeclaredName());
