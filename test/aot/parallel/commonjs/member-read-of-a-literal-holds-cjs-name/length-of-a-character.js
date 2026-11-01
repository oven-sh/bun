if ("abc"[1].length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared40 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-character", typeOfThis(), storeToUndeclaredName());
