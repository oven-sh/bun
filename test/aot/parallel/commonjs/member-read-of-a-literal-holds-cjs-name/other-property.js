if ({ b: 0 }.c) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared100 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("other-property", typeOfThis(), storeToUndeclaredName());
