if ((1 ? "ab" : 2)?.length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared126 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-behind-a-question-dot-of-a-conditional", typeOfThis(), storeToUndeclaredName());
