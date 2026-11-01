function called() {}
if ([1, 0][+(called(), 1)]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared110 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("index-behind-a-call-a-comma-and-a-plus", typeOfThis(), storeToUndeclaredName());
