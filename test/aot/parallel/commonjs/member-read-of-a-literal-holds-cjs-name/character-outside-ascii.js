if ("é"[0] === "x") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared120 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-outside-ascii", typeOfThis(), storeToUndeclaredName());
