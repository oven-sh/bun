[this][0];
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared92 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("item-is-this", typeOfThis(), storeToUndeclaredName());
