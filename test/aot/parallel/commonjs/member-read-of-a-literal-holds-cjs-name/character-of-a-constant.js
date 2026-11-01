const text = "ab";
if (text[0] === "b") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared36 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("character-of-a-constant", typeOfThis(), storeToUndeclaredName());
