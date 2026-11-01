if ({ a: [0] }.a[0]) module.exports = 1;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared17 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-of-a-property", typeOfThis(), storeToUndeclaredName());
