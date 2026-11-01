const character = "ab"[1];
if (character === "cd") module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared78 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-a-character", typeOfThis(), storeToUndeclaredName());
