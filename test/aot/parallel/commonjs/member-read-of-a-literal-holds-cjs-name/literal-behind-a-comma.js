if ((0, { b: 0 }).b) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared49 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("literal-behind-a-comma", typeOfThis(), storeToUndeclaredName());
