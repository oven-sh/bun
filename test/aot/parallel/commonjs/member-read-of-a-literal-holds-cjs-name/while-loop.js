while ({ b: 0 }.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared130 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while-loop", typeOfThis(), storeToUndeclaredName());
