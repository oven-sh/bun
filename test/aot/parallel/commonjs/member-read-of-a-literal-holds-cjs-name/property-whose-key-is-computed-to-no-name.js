if ({ "a-b": 0 }["a" + "-b"]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared5 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("property-whose-key-is-computed-to-no-name", typeOfThis(), storeToUndeclaredName());
