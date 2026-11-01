Object([typeof module, 0][1]);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared132 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("dropped-item-in-a-call", typeOfThis(), storeToUndeclaredName());
