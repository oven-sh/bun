this;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared8 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("this", typeOfThis(), storeToUndeclaredName());
