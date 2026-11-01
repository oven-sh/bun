function called() {}
if ([1, 0][(called(), 1)]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared109 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("index-behind-a-call-and-a-comma", typeOfThis(), storeToUndeclaredName());
