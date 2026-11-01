if ({ ab: 0 }["a" + "b"]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared101 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("key-computed-to-a-name", typeOfThis(), storeToUndeclaredName());
