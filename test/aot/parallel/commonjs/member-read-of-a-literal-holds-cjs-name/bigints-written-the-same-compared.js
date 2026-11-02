if (0x10n !== 0x10n) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared166 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("bigints-written-the-same-compared", typeOfThis(), storeToUndeclaredName());
