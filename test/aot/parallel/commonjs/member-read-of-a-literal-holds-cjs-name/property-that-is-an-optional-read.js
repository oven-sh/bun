var maybe;
if ({ b: maybe?.c }.b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared106 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-that-is-an-optional-read", typeOfThis(), storeToUndeclaredName());
