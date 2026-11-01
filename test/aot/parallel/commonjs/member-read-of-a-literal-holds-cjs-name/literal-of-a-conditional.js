if ((1 ? { b: 0 } : null).b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared50 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-of-a-conditional", typeOfThis(), storeToUndeclaredName());
