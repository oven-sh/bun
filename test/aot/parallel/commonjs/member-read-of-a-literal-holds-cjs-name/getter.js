if ({ get b() { return 0; } }.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared97 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("getter", typeOfThis(), storeToUndeclaredName());
