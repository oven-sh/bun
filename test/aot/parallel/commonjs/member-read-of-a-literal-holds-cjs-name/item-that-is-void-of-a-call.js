function said() {
  console.log("the item runs");
}
if ([void said()][0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared75 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-that-is-void-of-a-call", typeOfThis(), storeToUndeclaredName());
