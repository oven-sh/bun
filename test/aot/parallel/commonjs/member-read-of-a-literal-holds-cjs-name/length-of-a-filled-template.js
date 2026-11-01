if (`a${1}b`.length === 4) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared32 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-a-filled-template", typeOfThis(), storeToUndeclaredName());
