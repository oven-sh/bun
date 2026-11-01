if ([1, 0]["1"]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared108 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("index-that-is-a-text", typeOfThis(), storeToUndeclaredName());
