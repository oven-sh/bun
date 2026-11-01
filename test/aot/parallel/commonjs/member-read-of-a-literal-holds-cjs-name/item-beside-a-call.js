function called() {}
if ([called(), 0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared114 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-beside-a-call", typeOfThis(), storeToUndeclaredName());
