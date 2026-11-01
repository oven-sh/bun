function called() {}
const zero = [(called(), 0)][0];
if (zero) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared149 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-an-item-behind-a-call", typeOfThis(), storeToUndeclaredName());
