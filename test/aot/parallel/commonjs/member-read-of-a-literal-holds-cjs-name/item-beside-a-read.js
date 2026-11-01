var holder = {};
if ([holder.a, 0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared115 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-beside-a-read", typeOfThis(), storeToUndeclaredName());
