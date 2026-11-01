if ({ a: { b: 0 } }.a?.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared105 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-behind-a-question-dot-of-a-property", typeOfThis(), storeToUndeclaredName());
