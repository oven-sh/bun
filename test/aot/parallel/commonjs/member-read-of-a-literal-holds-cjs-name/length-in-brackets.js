if ("ab"["length"] === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared26 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-in-brackets", typeOfThis(), storeToUndeclaredName());
