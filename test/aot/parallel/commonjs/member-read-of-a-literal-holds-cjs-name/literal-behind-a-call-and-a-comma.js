function called() {}
if ((called(), [0])[0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared128 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
