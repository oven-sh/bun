if ({ b: 0 }["b"]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared2 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-in-brackets", typeOfThis(), storeToUndeclaredName());
