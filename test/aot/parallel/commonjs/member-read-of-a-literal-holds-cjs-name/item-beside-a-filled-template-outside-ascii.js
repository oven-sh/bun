if ([`é${1}`, 0][1]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared156 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-beside-a-filled-template-outside-ascii", typeOfThis(), storeToUndeclaredName());
