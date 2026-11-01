const length = "abc".length;
if ([1, 1, 1, 0][length]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared48 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("constant-of-a-length", typeOfThis(), storeToUndeclaredName());
