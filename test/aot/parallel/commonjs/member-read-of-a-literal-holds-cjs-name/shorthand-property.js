var b = 0;
if ({ b }.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared95 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("shorthand-property", typeOfThis(), storeToUndeclaredName());
