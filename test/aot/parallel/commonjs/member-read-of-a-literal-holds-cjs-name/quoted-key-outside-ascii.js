if ({ "é": 0 }.é) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared103 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("quoted-key-outside-ascii", typeOfThis(), storeToUndeclaredName());
