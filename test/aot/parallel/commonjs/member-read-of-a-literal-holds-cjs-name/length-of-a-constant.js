const text = "ab";
if (text.length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared29 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-constant", typeOfThis(), storeToUndeclaredName());
