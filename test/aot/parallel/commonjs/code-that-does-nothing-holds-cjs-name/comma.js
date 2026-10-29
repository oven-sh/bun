typeof module, typeof exports, 1;
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
console.log("comma", typeOfThis(), storeToUndeclaredName());
