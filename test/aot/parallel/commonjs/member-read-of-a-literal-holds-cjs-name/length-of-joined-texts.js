if (("a" + "b").length === 3) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared31 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("length-of-joined-texts", typeOfThis(), storeToUndeclaredName());
