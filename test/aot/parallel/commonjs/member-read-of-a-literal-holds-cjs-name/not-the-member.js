if (!{ a: 1 }.a) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared42 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("not-the-member", typeOfThis(), storeToUndeclaredName());
