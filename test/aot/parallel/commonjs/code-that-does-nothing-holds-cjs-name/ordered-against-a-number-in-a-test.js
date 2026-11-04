if (typeof module < 1) {
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared114 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("ordered-against-a-number-in-a-test", typeOfThis(), storeToUndeclaredName());
