function said() {
  console.log("the property runs");
}
if ({ k: (said(), 0) }.k) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared76 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-behind-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
